-- =====================================================================
-- Recordatorio antes de cada sesión + resumen «Hoy» + reintentos limitados.
-- Requiere 0002_whatsapp_recordatorios.sql. Se puede ejecutar de nuevo.
--
--   · remind_minutes: minutos antes de cada Sesión Zajuna, Sesión adicional
--     o Dudas (null = sin recordatorio). Por defecto 120 (2 horas).
--   · pg_cron corre cada 5 minutos: resumen diario a la hora elegida y
--     recordatorios de sesiones que empiezan dentro de remind_minutes.
--   · Cada recordatorio se envía una sola vez por sesión (si cambia la hora,
--     vuelve a avisar). Máximo 3 intentos fallidos por mensaje.
-- =====================================================================

alter table public.notify_settings
  add column if not exists remind_minutes smallint default 120
  check (remind_minutes is null or remind_minutes between 10 and 720);

alter table public.notification_log add column if not exists event_key text;
alter table public.notification_log drop constraint if exists notification_log_kind_check;
alter table public.notification_log add constraint notification_log_kind_check
  check (kind in ('digest', 'test', 'reminder'));
create unique index if not exists notification_log_one_reminder
  on public.notification_log (event_key) where kind = 'reminder' and status = 'sent';

-- ---------------------------------------------------------------------------
-- Resumen de un día; p_from = solo lo que aún no ha empezado / vencido.
-- ---------------------------------------------------------------------------
create or replace function public.digest_message_from(p_date date, p_label text, p_from time)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  days   constant text[] := array['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
  months constant text[] := array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  lines  text;
begin
  select string_agg(line, E'\n' order by ord, sort_at, title)
    into lines
    from (
      select e.sort_at, e.title,
             case when e.category = 'SESION' then 0 else 1 end as ord,
             case e.type_label
               when 'SESION_ZAJUNA'    then '🔵 ' || trim(to_char(date '2000-01-01' + e.start_time, 'FMHH12:MI AM')) || ' – Sesión Zajuna: ' || e.title
               when 'SESION_ADICIONAL' then '🔷 ' || trim(to_char(date '2000-01-01' + e.start_time, 'FMHH12:MI AM')) || ' – Sesión adicional: ' || e.title
               when 'DUDAS'            then '🟡 ' || trim(to_char(date '2000-01-01' + e.start_time, 'FMHH12:MI AM')) || ' – Dudas: ' || e.title
               when 'ENTREGA'          then '🔴 Entrega: '      || e.title
               when 'CUESTIONARIO'     then '🟢 Cuestionario: ' || e.title
               when 'FORO'             then '🟣 Foro: '         || e.title
               else '• ' || e.title
             end
             || case when e.category = 'ENTREGA'
                     then ' (vence ' || trim(to_char(date '2000-01-01' + coalesce(e.start_time, time '23:59'), 'FMHH12:MI AM')) || ')'
                     else '' end
             || coalesce(' · 👤 ' || e.instructor, '')
             as line
        from public.events e
       where e.event_date = p_date
         and e.category in ('SESION', 'ENTREGA')   -- las grabaciones no tienen hora de asistencia
         and (p_from is null or coalesce(e.start_time, time '23:59') >= p_from)
    ) x;

  if lines is null then
    return null;
  end if;

  return '📅 *' || p_label || ', ' || days[extract(dow from p_date)::int + 1] || ' '
         || extract(day from p_date)::int || ' de ' || months[extract(month from p_date)::int] || '*'
         || E'\n' || lines
         || E'\n\n' || 'Ver calendario: https://calendario-academico-eta.vercel.app';
end;
$$;

-- La versión de 0002 (todo el día) ahora delega en digest_message_from.
create or replace function public.digest_message(p_date date, p_label text default 'Mañana')
returns text language sql stable security definer set search_path = ''
as $$ select public.digest_message_from(p_date, p_label, null) $$;

-- ---------------------------------------------------------------------------
-- Resumen diario (máximo 3 intentos si CallMeBot falla)
-- ---------------------------------------------------------------------------
create or replace function public.run_daily_digest(p_force boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  s        public.notify_settings;
  v_now    timestamp := now() at time zone 'America/Bogota';
  v_target date := (now() at time zone 'America/Bogota')::date + 1;
  v_msg    text;
  r        record;
begin
  select * into s from public.notify_settings where id;
  if not found or not s.enabled then return 'desactivado'; end if;
  if not p_force and extract(hour from v_now)::int <> s.send_hour then return 'no es la hora'; end if;
  if exists (select 1 from public.notification_log
              where kind = 'digest' and target_date = v_target and status in ('sent', 'skipped')) then
    return 'ya enviado';
  end if;
  if (select count(*) from public.notification_log
       where kind = 'digest' and target_date = v_target and status = 'error') >= 3 then
    return 'demasiados errores';
  end if;

  v_msg := public.digest_message(v_target, 'Mañana');
  if v_msg is null then
    insert into public.notification_log (kind, target_date, status, detail)
    values ('digest', v_target, 'skipped', 'No hay actividades para ese día.');
    return 'sin actividades';
  end if;

  select * into r from public.callmebot_send(v_msg);
  insert into public.notification_log (kind, target_date, message, status, http_status, detail)
  values ('digest', v_target, v_msg, case when r.ok then 'sent' else 'error' end, r.http_status, r.detail);
  return case when r.ok then 'enviado' else 'error' end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resumen de HOY (lo que falta del día). Uso puntual: p_job = nombre del
-- trabajo de pg_cron que lo programó, para borrarlo después de ejecutarse.
-- ---------------------------------------------------------------------------
create or replace function public.send_today_digest(p_job text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_msg   text;
  r       record;
  v_out   text;
begin
  if exists (select 1 from public.notification_log
              where kind = 'digest' and target_date = v_today and status in ('sent', 'skipped')) then
    v_out := 'ya enviado';
  else
    v_msg := public.digest_message_from(v_today, 'Hoy', (now() at time zone 'America/Bogota')::time);
    if v_msg is null then
      insert into public.notification_log (kind, target_date, status, detail)
      values ('digest', v_today, 'skipped', 'No quedan actividades hoy.');
      v_out := 'sin actividades';
    else
      select * into r from public.callmebot_send(v_msg);
      insert into public.notification_log (kind, target_date, message, status, http_status, detail)
      values ('digest', v_today, v_msg, case when r.ok then 'sent' else 'error' end, r.http_status, r.detail);
      v_out := case when r.ok then 'enviado' else 'error' end;
    end if;
  end if;
  if p_job is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = p_job;
  end if;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Recordatorio antes de cada sesión (Zajuna, adicional, dudas)
-- ---------------------------------------------------------------------------
create or replace function public.run_session_reminders()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  s      public.notify_settings;
  e      record;
  v_key  text;
  v_mins int;
  v_in   text;
  v_msg  text;
  r      record;
  n      int := 0;
begin
  select * into s from public.notify_settings where id;
  if not found or not s.enabled or s.remind_minutes is null then return 0; end if;

  for e in
    select ev.*
      from public.events ev
     where ev.category = 'SESION'
       and ev.start_time is not null
       and ev.sort_at > now()
       and ev.sort_at <= now() + make_interval(mins => s.remind_minutes)
     order by ev.sort_at
  loop
    v_key := e.event_id || '|' || e.event_date || '|' || e.start_time;
    continue when exists (select 1 from public.notification_log
                           where kind = 'reminder' and event_key = v_key and status = 'sent');
    continue when (select count(*) from public.notification_log
                    where kind = 'reminder' and event_key = v_key and status = 'error') >= 3;

    v_mins := (round(extract(epoch from (e.sort_at - now())) / 300.0) * 5)::int;
    v_in := case when v_mins >= 60
                 then (v_mins / 60) || ' h' || case when v_mins % 60 > 0 then ' ' || (v_mins % 60) || ' min' else '' end
                 else greatest(v_mins, 1) || ' min' end;

    v_msg := '⏰ *En ' || v_in || ': '
             || case e.type_label when 'SESION_ADICIONAL' then 'Sesión adicional'
                                  when 'DUDAS' then 'Espacio de dudas'
                                  else 'Sesión Zajuna' end || '*' || E'\n'
             || case e.type_label when 'SESION_ADICIONAL' then '🔷 ' when 'DUDAS' then '🟡 ' else '🔵 ' end || e.title || E'\n'
             || '🕒 ' || trim(to_char(date '2000-01-01' + e.start_time, 'FMHH12:MI AM'))
             || coalesce(' – ' || trim(to_char(date '2000-01-01' + e.end_time, 'FMHH12:MI AM')), '')
             || coalesce(E'\n👤 Instructor: ' || e.instructor, '')
             || case when e.link is not null
                     then E'\n' || case when e.type_label = 'DUDAS' then '💬 Chat: ' else '🔗 Ingresar: ' end || e.link
                     else '' end;

    select * into r from public.callmebot_send(v_msg);
    insert into public.notification_log (kind, target_date, event_key, message, status, http_status, detail)
    values ('reminder', e.event_date, v_key, v_msg, case when r.ok then 'sent' else 'error' end, r.http_status, r.detail);
    n := n + 1;
  end loop;
  return n;
end;
$$;

create or replace function public.run_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.run_daily_digest();
  perform public.run_session_reminders();
end;
$$;

-- ---------------------------------------------------------------------------
-- Panel /admin: estado y guardado con el nuevo ajuste
-- ---------------------------------------------------------------------------
create or replace function public.notify_get_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  s public.notify_settings;
  v_tomorrow date := (now() at time zone 'America/Bogota')::date + 1;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  select * into s from public.notify_settings where id;
  return jsonb_build_object(
    'enabled',        coalesce(s.enabled, false),
    'phone',          s.phone,
    'send_hour',      coalesce(s.send_hour, 20),
    'remind_minutes', s.remind_minutes,
    'has_key',        exists (select 1 from vault.decrypted_secrets d where d.name = 'callmebot_apikey' and btrim(coalesce(d.decrypted_secret, '')) <> ''),
    'preview',        public.digest_message(v_tomorrow, 'Mañana'),
    'log', coalesce((
      select jsonb_agg(to_jsonb(l) - 'message' - 'event_key' order by l.created_at desc)
        from (select * from public.notification_log order by created_at desc limit 10) l
    ), '[]'::jsonb)
  );
end;
$$;

-- Nueva versión con p_remind_minutes (la de 4 parámetros de 0002 sigue existiendo y no la usa la app).
create or replace function public.notify_save_settings(
  p_enabled boolean, p_phone text, p_send_hour int, p_apikey text, p_remind_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_id    uuid;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if v_phone is not null and v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'INVALID_PHONE'; end if;
  if p_send_hour is null or p_send_hour not between 0 and 23 then raise exception 'INVALID_HOUR'; end if;
  if p_remind_minutes is not null and p_remind_minutes not between 10 and 720 then raise exception 'INVALID_REMIND'; end if;

  if p_apikey is not null and btrim(p_apikey) <> '' then
    if btrim(p_apikey) !~ '^[A-Za-z0-9_-]{3,64}$' then raise exception 'INVALID_KEY'; end if;
    select id into v_id from vault.secrets where name = 'callmebot_apikey';
    if v_id is null then
      perform vault.create_secret(btrim(p_apikey), 'callmebot_apikey', 'Clave de CallMeBot (recordatorio por WhatsApp)');
    else
      perform vault.update_secret(v_id, btrim(p_apikey));
    end if;
  end if;

  update public.notify_settings
     set enabled = coalesce(p_enabled, false), phone = v_phone, send_hour = p_send_hour,
         remind_minutes = p_remind_minutes, updated_at = now(), updated_by = auth.uid()
   where id;
  return public.notify_get_status();
end;
$$;

revoke all on function public.digest_message_from(date, text, time)                     from public, anon, authenticated;
revoke all on function public.digest_message(date, text)                                from public, anon, authenticated;
revoke all on function public.run_daily_digest(boolean)                                 from public, anon, authenticated;
revoke all on function public.send_today_digest(text)                                   from public, anon, authenticated;
revoke all on function public.run_session_reminders()                                   from public, anon, authenticated;
revoke all on function public.run_notifications()                                       from public, anon, authenticated;
revoke all on function public.notify_get_status()                                       from public, anon;
revoke all on function public.notify_save_settings(boolean, text, int, text, int)       from public, anon;
grant execute on function public.notify_get_status()                                    to authenticated;
grant execute on function public.notify_save_settings(boolean, text, int, text, int)    to authenticated;

-- Cada 5 minutos: resumen diario (a la hora elegida) y recordatorios de sesiones.
select cron.unschedule(jobid) from cron.job where jobname in ('calendario-whatsapp-diario', 'calendario-whatsapp');
select cron.schedule('calendario-whatsapp', '*/5 * * * *', 'select public.run_notifications()');

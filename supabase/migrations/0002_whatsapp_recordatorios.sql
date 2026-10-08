-- =====================================================================
-- Recordatorio diario por WhatsApp (CallMeBot) para el administrador.
--
-- Cada hora, pg_cron llama a public.run_daily_digest(). A la hora elegida
-- (por defecto 8:00 PM de Colombia) arma el resumen de MAÑANA y lo envía
-- a un solo número por la API gratuita de CallMeBot (uso personal).
--   · Sin actividades mañana → no se envía nada (queda «omitido» en la bitácora).
--   · Nunca se envía dos veces el mismo día.
--   · La clave de CallMeBot se guarda cifrada en Supabase Vault.
-- Se puede ejecutar de nuevo sin problema.
-- =====================================================================

create extension if not exists http with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------------------
-- 1. Configuración (una sola fila) y bitácora de envíos
-- ---------------------------------------------------------------------------
create table if not exists public.notify_settings (
  id          boolean primary key default true check (id),
  enabled     boolean  not null default false,
  phone       text     check (phone is null or phone ~ '^\+[0-9]{8,15}$'),
  send_hour   smallint not null default 20 check (send_hour between 0 and 23),
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
comment on table public.notify_settings is 'Recordatorio diario por WhatsApp (CallMeBot). La clave está en Vault (callmebot_apikey).';
insert into public.notify_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.notification_log (
  id           bigint generated always as identity primary key,
  kind         text not null check (kind in ('digest', 'test')),
  target_date  date,
  message      text,
  status       text not null check (status in ('sent', 'skipped', 'error')),
  http_status  int,
  detail       text,
  created_at   timestamptz not null default now()
);
create index if not exists notification_log_created_idx on public.notification_log (created_at desc);
-- Un solo resumen enviado u omitido por fecha: evita duplicados si el cron corre dos veces.
create unique index if not exists notification_log_one_digest_per_day
  on public.notification_log (target_date) where kind = 'digest' and status in ('sent', 'skipped');

alter table public.notify_settings enable row level security;
alter table public.notification_log enable row level security;
revoke all on public.notify_settings, public.notification_log from anon, authenticated;
-- Lectura y cambios solo mediante las funciones de abajo (verifican is_admin()).

-- ---------------------------------------------------------------------------
-- 2. Texto del resumen de un día (null si no hay nada que avisar)
-- ---------------------------------------------------------------------------
create or replace function public.digest_message(p_date date, p_label text default 'Mañana')
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
             as line
        from public.events e
       where e.event_date = p_date
         and e.category in ('SESION', 'ENTREGA')   -- las grabaciones no tienen hora de asistencia
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

-- ---------------------------------------------------------------------------
-- 3. Envío por CallMeBot (interno)
-- ---------------------------------------------------------------------------
create or replace function public.callmebot_send(p_text text, out ok boolean, out http_status int, out detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone text;
  v_key   text;
  v_resp  extensions.http_response;
begin
  select s.phone into v_phone from public.notify_settings s where s.id;
  select d.decrypted_secret into v_key from vault.decrypted_secrets d where d.name = 'callmebot_apikey';
  if v_phone is null or v_key is null or btrim(v_key) = '' then
    ok := false; http_status := null; detail := 'Falta el número o la clave de CallMeBot.';
    return;
  end if;

  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  begin
    v_resp := extensions.http_get(
      'https://api.callmebot.com/whatsapp.php?phone=' || extensions.urlencode(v_phone)
      || '&text=' || extensions.urlencode(p_text)
      || '&apikey=' || extensions.urlencode(btrim(v_key))
    );
  exception when others then
    ok := false; http_status := null; detail := 'No se pudo conectar con CallMeBot: ' || left(sqlerrm, 200);
    return;
  end;

  http_status := v_resp.status;
  -- CallMeBot responde con una página HTML corta; se guarda el texto sin etiquetas.
  detail := left(btrim(regexp_replace(regexp_replace(coalesce(v_resp.content, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 300);
  ok := v_resp.status = 200 and detail !~* '(error|invalid|not (allowed|activated|valid)|wrong|denied)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Tarea programada: resumen de mañana a la hora elegida
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
-- 5. Funciones del panel /admin (solo administradores)
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
    'enabled',   coalesce(s.enabled, false),
    'phone',     s.phone,
    'send_hour', coalesce(s.send_hour, 20),
    'has_key',   exists (select 1 from vault.decrypted_secrets d where d.name = 'callmebot_apikey' and btrim(coalesce(d.decrypted_secret, '')) <> ''),
    'preview',   public.digest_message(v_tomorrow, 'Mañana'),
    'log', coalesce((
      select jsonb_agg(to_jsonb(l) - 'message' order by l.created_at desc)
        from (select * from public.notification_log order by created_at desc limit 8) l
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.notify_save_settings(p_enabled boolean, p_phone text, p_send_hour int, p_apikey text default null)
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
         updated_at = now(), updated_by = auth.uid()
   where id;
  return public.notify_get_status();
end;
$$;

create or replace function public.notify_send_test()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview text;
  v_msg     text;
  r         record;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if (select count(*) from public.notification_log
       where kind = 'test' and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'TOO_MANY_TESTS';
  end if;

  v_preview := public.digest_message((now() at time zone 'America/Bogota')::date + 1, 'Mañana');
  v_msg := '✅ *Prueba del Calendario Académico*' || E'\n'
           || 'Así te llegará el recordatorio diario.' || E'\n\n'
           || coalesce(v_preview, 'Mañana no hay sesiones ni fechas límite. Esos días no se envía mensaje.');

  select * into r from public.callmebot_send(v_msg);
  insert into public.notification_log (kind, target_date, message, status, http_status, detail)
  values ('test', null, v_msg, case when r.ok then 'sent' else 'error' end, r.http_status, r.detail);
  return jsonb_build_object('ok', r.ok, 'http_status', r.http_status, 'detail', r.detail);
end;
$$;

revoke all on function public.digest_message(date, text)                          from public, anon, authenticated;
revoke all on function public.callmebot_send(text)                                from public, anon, authenticated;
revoke all on function public.run_daily_digest(boolean)                           from public, anon, authenticated;
revoke all on function public.notify_get_status()                                 from public, anon;
revoke all on function public.notify_save_settings(boolean, text, int, text)      from public, anon;
revoke all on function public.notify_send_test()                                  from public, anon;
grant execute on function public.notify_get_status()                              to authenticated;
grant execute on function public.notify_save_settings(boolean, text, int, text)   to authenticated;
grant execute on function public.notify_send_test()                               to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Programación: cada hora en punto (la función decide si es la hora elegida)
-- ---------------------------------------------------------------------------
select cron.unschedule(jobid) from cron.job where jobname = 'calendario-whatsapp-diario';
select cron.schedule('calendario-whatsapp-diario', '0 * * * *', 'select public.run_daily_digest()');

-- =====================================================================
-- Recordatorios por WhatsApp a VARIOS números (cada uno con su apikey).
-- Requiere 0002 y 0003. Se puede ejecutar de nuevo.
--
--   · notify_recipients: lista de destinatarios (nombre, número, activo).
--     La clave de cada uno va cifrada en Vault (secret_name).
--   · El número que ya existía queda como «Principal» con su clave actual.
--   · Cada mensaje (resumen, aviso de sesión, prueba) se envía a todos los
--     destinatarios activos y queda en la bitácora con su número.
--   · Por destinatario: nunca dos veces el mismo resumen o aviso; máximo 3
--     intentos fallidos. Si uno falla, los demás reciben igual.
--   · Quitar un destinatario lo archiva (no se borra su historial).
-- =====================================================================

create table if not exists public.notify_recipients (
  id          bigint generated always as identity primary key,
  label       text not null default 'Principal' check (char_length(label) between 1 and 40),
  phone       text not null unique check (phone ~ '^\+[0-9]{8,15}$'),
  enabled     boolean not null default true,
  archived    boolean not null default false,
  secret_name text not null unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.notify_recipients enable row level security;
revoke all on public.notify_recipients from anon, authenticated;

-- El número que ya estaba configurado pasa a ser el destinatario «Principal».
insert into public.notify_recipients (label, phone, secret_name)
select 'Principal', s.phone, 'callmebot_apikey'
  from public.notify_settings s
 where s.id and s.phone is not null
on conflict (phone) do nothing;

-- Bitácora por destinatario.
alter table public.notification_log add column if not exists recipient text;
update public.notification_log l
   set recipient = s.phone
  from public.notify_settings s
 where s.id and l.recipient is null and l.kind in ('digest', 'reminder', 'test') and l.status <> 'skipped';

drop index if exists public.notification_log_one_digest_per_day;
drop index if exists public.notification_log_one_reminder;
create unique index if not exists notification_log_digest_once
  on public.notification_log (target_date, coalesce(recipient, '')) where kind = 'digest' and status in ('sent', 'skipped');
create unique index if not exists notification_log_reminder_once
  on public.notification_log (event_key, coalesce(recipient, '')) where kind = 'reminder' and status = 'sent';

-- ---------------------------------------------------------------------------
-- Envío a un número concreto
-- ---------------------------------------------------------------------------
create or replace function public.callmebot_send_to(p_phone text, p_key text, p_text text,
                                                    out ok boolean, out http_status int, out detail text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_resp extensions.http_response;
begin
  if p_phone is null or p_key is null or btrim(p_key) = '' then
    ok := false; http_status := null; detail := 'Falta el número o la clave de CallMeBot.';
    return;
  end if;
  perform extensions.http_set_curlopt('CURLOPT_TIMEOUT', '25');
  begin
    v_resp := extensions.http_get(
      'https://api.callmebot.com/whatsapp.php?phone=' || extensions.urlencode(p_phone)
      || '&text=' || extensions.urlencode(p_text)
      || '&apikey=' || extensions.urlencode(btrim(p_key))
    );
  exception when others then
    ok := false; http_status := null; detail := 'No se pudo conectar con CallMeBot: ' || left(sqlerrm, 200);
    return;
  end;
  http_status := v_resp.status;
  detail := left(btrim(regexp_replace(regexp_replace(coalesce(v_resp.content, ''), '<[^>]*>', ' ', 'g'), '\s+', ' ', 'g')), 300);
  ok := v_resp.status = 200 and detail !~* '(error|invalid|not (allowed|activated|valid)|wrong|denied)';
end;
$$;

-- ---------------------------------------------------------------------------
-- Envío a todos los destinatarios activos (o a uno: p_only)
-- ---------------------------------------------------------------------------
create or replace function public.notify_broadcast(p_kind text, p_target date, p_event_key text, p_msg text, p_only bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  rc  record;
  r   record;
  v_out jsonb := '[]'::jsonb;
begin
  for rc in
    select n.id, n.label, n.phone, d.decrypted_secret as key
      from public.notify_recipients n
      left join vault.decrypted_secrets d on d.name = n.secret_name
     where not n.archived and (p_only is not null and n.id = p_only or p_only is null and n.enabled)
     order by n.id
  loop
    if p_kind = 'digest' and exists (select 1 from public.notification_log l
         where l.kind = 'digest' and l.target_date = p_target and l.recipient = rc.phone and l.status = 'sent') then
      continue;
    end if;
    if p_kind = 'reminder' and exists (select 1 from public.notification_log l
         where l.kind = 'reminder' and l.event_key = p_event_key and l.recipient = rc.phone and l.status = 'sent') then
      continue;
    end if;
    if p_kind in ('digest', 'reminder') and (select count(*) from public.notification_log l
         where l.kind = p_kind and l.recipient = rc.phone and l.status = 'error'
           and (p_kind = 'digest' and l.target_date = p_target or p_kind = 'reminder' and l.event_key = p_event_key)) >= 3 then
      continue;
    end if;

    select * into r from public.callmebot_send_to(rc.phone, rc.key, p_msg);
    insert into public.notification_log (kind, target_date, event_key, message, status, http_status, detail, recipient)
    values (p_kind, p_target, p_event_key, p_msg, case when r.ok then 'sent' else 'error' end, r.http_status, r.detail, rc.phone);
    v_out := v_out || jsonb_build_object('label', rc.label, 'phone', rc.phone, 'ok', r.ok, 'detail', r.detail);
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- Resumen diario, resumen de hoy y avisos de sesión → a todos
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
  v_res    jsonb;
begin
  select * into s from public.notify_settings where id;
  if not found or not s.enabled then return 'desactivado'; end if;
  if not p_force and extract(hour from v_now)::int <> s.send_hour then return 'no es la hora'; end if;
  if exists (select 1 from public.notification_log
              where kind = 'digest' and target_date = v_target and status = 'skipped') then
    return 'sin actividades';
  end if;
  v_msg := public.digest_message(v_target, 'Mañana');
  if v_msg is null then
    insert into public.notification_log (kind, target_date, status, detail)
    values ('digest', v_target, 'skipped', 'No hay actividades para ese día.');
    return 'sin actividades';
  end if;
  v_res := public.notify_broadcast('digest', v_target, null, v_msg);
  return jsonb_array_length(v_res) || ' envíos';
end;
$$;

create or replace function public.send_today_digest(p_job text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'America/Bogota')::date;
  v_msg   text;
  v_out   text;
begin
  v_msg := public.digest_message_from(v_today, 'Hoy', (now() at time zone 'America/Bogota')::time);
  if v_msg is null then
    v_out := 'sin actividades';
  else
    v_out := jsonb_array_length(public.notify_broadcast('digest', v_today, null, v_msg)) || ' envíos';
  end if;
  if p_job is not null then
    perform cron.unschedule(jobid) from cron.job where jobname = p_job;
  end if;
  return v_out;
end;
$$;

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
  n      int := 0;
begin
  select * into s from public.notify_settings where id;
  if not found or not s.enabled or s.remind_minutes is null then return 0; end if;
  for e in
    select ev.* from public.events ev
     where ev.category = 'SESION' and ev.start_time is not null
       and ev.sort_at > now() and ev.sort_at <= now() + make_interval(mins => s.remind_minutes)
     order by ev.sort_at
  loop
    v_key := e.event_id || '|' || e.event_date || '|' || e.start_time;
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
    n := n + jsonb_array_length(public.notify_broadcast('reminder', e.event_date, v_key, v_msg));
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Panel /admin
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
    'send_hour',      coalesce(s.send_hour, 20),
    'remind_minutes', s.remind_minutes,
    'recipients', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', n.id, 'label', n.label, 'phone', n.phone, 'enabled', n.enabled,
               'has_key', exists (select 1 from vault.decrypted_secrets d
                                   where d.name = n.secret_name and btrim(coalesce(d.decrypted_secret, '')) <> ''))
             order by n.id)
        from public.notify_recipients n where not n.archived), '[]'::jsonb),
    -- Compatibilidad con la versión anterior del panel.
    'phone',   (select n.phone from public.notify_recipients n where not n.archived order by n.id limit 1),
    'has_key', exists (select 1 from public.notify_recipients n join vault.decrypted_secrets d on d.name = n.secret_name
                        where not n.archived and btrim(coalesce(d.decrypted_secret, '')) <> ''),
    'preview', public.digest_message(v_tomorrow, 'Mañana'),
    'log', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', l.id, 'kind', l.kind, 'target_date', l.target_date, 'status', l.status,
               'http_status', l.http_status, 'detail', l.detail, 'created_at', l.created_at,
               'recipient', coalesce((select n.label from public.notify_recipients n where n.phone = l.recipient), l.recipient))
             order by l.created_at desc)
        from (select * from public.notification_log order by created_at desc limit 12) l
    ), '[]'::jsonb)
  );
end;
$$;

-- Ajustes generales (activar, hora del resumen, aviso antes de cada sesión).
create or replace function public.notify_save_general(p_enabled boolean, p_send_hour int, p_remind_minutes int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if p_send_hour is null or p_send_hour not between 0 and 23 then raise exception 'INVALID_HOUR'; end if;
  if p_remind_minutes is not null and p_remind_minutes not between 10 and 720 then raise exception 'INVALID_REMIND'; end if;
  update public.notify_settings
     set enabled = coalesce(p_enabled, false), send_hour = p_send_hour, remind_minutes = p_remind_minutes,
         updated_at = now(), updated_by = auth.uid()
   where id;
  return public.notify_get_status();
end;
$$;

-- Agregar (p_id null) o editar un destinatario. La clave solo se cambia si se envía.
create or replace function public.notify_save_recipient(p_id bigint, p_label text, p_phone text, p_apikey text, p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_phone  text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_key    text := nullif(btrim(coalesce(p_apikey, '')), '');
  v_id     bigint := p_id;
  v_secret text;
  v_sid    uuid;
  v_other  record;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if v_phone is null or v_phone !~ '^\+[0-9]{8,15}$' then raise exception 'INVALID_PHONE'; end if;
  if v_label is null or char_length(v_label) > 40 then raise exception 'INVALID_LABEL'; end if;
  if v_key is not null and v_key !~ '^[A-Za-z0-9_-]{3,64}$' then raise exception 'INVALID_KEY'; end if;

  select * into v_other from public.notify_recipients where phone = v_phone and id is distinct from v_id;
  if found then
    if not v_other.archived then raise exception 'DUPLICATE_PHONE'; end if;
    if v_id is null then v_id := v_other.id; end if;   -- volver a agregar un número que se había quitado
  end if;

  if v_id is null then
    if v_key is null then raise exception 'KEY_REQUIRED'; end if;
    -- Un segundo número requiere los índices por destinatario (sección inicial de este archivo).
    if exists (select 1 from pg_catalog.pg_indexes where schemaname = 'public'
                and indexname in ('notification_log_one_digest_per_day', 'notification_log_one_reminder'))
       and exists (select 1 from public.notify_recipients where not archived) then
      raise exception 'SETUP_PENDING';
    end if;
    insert into public.notify_recipients (label, phone, enabled, secret_name)
    values (v_label, v_phone, coalesce(p_enabled, true), 'callmebot_apikey_' || replace(gen_random_uuid()::text, '-', ''))
    returning id, secret_name into v_id, v_secret;
  else
    update public.notify_recipients
       set label = v_label, phone = v_phone, enabled = coalesce(p_enabled, enabled), archived = false, updated_at = now()
     where id = v_id
    returning secret_name into v_secret;
    if v_secret is null then raise exception 'NOT_FOUND'; end if;
  end if;

  if v_key is not null then
    select id into v_sid from vault.secrets where name = v_secret;
    if v_sid is null then
      perform vault.create_secret(v_key, v_secret, 'Clave de CallMeBot de ' || v_label);
    else
      perform vault.update_secret(v_sid, v_key);
    end if;
  end if;
  return public.notify_get_status();
end;
$$;

-- Quitar un destinatario: se archiva (deja de recibir; la bitácora se conserva).
create or replace function public.notify_archive_recipient(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  update public.notify_recipients set archived = true, enabled = false, updated_at = now() where id = p_id;
  return public.notify_get_status();
end;
$$;

-- Prueba: a todos los activos (p_id null) o a uno.
create or replace function public.notify_test_recipient(p_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preview text;
  v_msg     text;
begin
  if not public.is_admin() then raise exception 'NOT_ADMIN'; end if;
  if (select count(*) from public.notification_log
       where kind = 'test' and created_at > now() - interval '1 hour') >= 8 then
    raise exception 'TOO_MANY_TESTS';
  end if;
  v_preview := public.digest_message((now() at time zone 'America/Bogota')::date + 1, 'Mañana');
  v_msg := '✅ *Prueba del Calendario Académico*' || E'\n'
           || 'Así te llegará el recordatorio diario.' || E'\n\n'
           || coalesce(v_preview, 'Mañana no hay sesiones ni fechas límite. Esos días no se envía mensaje.');
  return jsonb_build_object('results', public.notify_broadcast('test', null, null, v_msg, p_id));
end;
$$;

revoke all on function public.callmebot_send_to(text, text, text)                         from public, anon, authenticated;
revoke all on function public.notify_broadcast(text, date, text, text, bigint)            from public, anon, authenticated;
revoke all on function public.run_daily_digest(boolean)                                   from public, anon, authenticated;
revoke all on function public.send_today_digest(text)                                     from public, anon, authenticated;
revoke all on function public.run_session_reminders()                                     from public, anon, authenticated;
revoke all on function public.notify_get_status()                                         from public, anon;
revoke all on function public.notify_save_general(boolean, int, int)                      from public, anon;
revoke all on function public.notify_save_recipient(bigint, text, text, text, boolean)    from public, anon;
revoke all on function public.notify_archive_recipient(bigint)                            from public, anon;
revoke all on function public.notify_test_recipient(bigint)                               from public, anon;
grant execute on function public.notify_get_status()                                      to authenticated;
grant execute on function public.notify_save_general(boolean, int, int)                   to authenticated;
grant execute on function public.notify_save_recipient(bigint, text, text, text, boolean) to authenticated;
grant execute on function public.notify_archive_recipient(bigint)                         to authenticated;
grant execute on function public.notify_test_recipient(bigint)                            to authenticated;

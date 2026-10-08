-- =============================================================================
-- Calendario Académico · Migración inicial
-- Ejecutar UNA vez en Supabase → SQL Editor (o con `supabase db push`).
--
-- Contiene:
--   1. Tablas: admins, events, imports, event_snapshots, calendar_state
--   2. Funciones: is_admin, apply_calendar_import (transaccional),
--      restore_snapshot ("Deshacer"), log_failed_import, keepalive
--   3. Seguridad: RLS (el público solo lee eventos), permisos de funciones
--   4. Storage: bucket privado "imports" para guardar los Excel originales
--
-- Reglas clave:
--   * Las fechas y horas se guardan como hora local de Colombia (sin zona).
--   * sort_at es el instante real (America/Bogota) y ordena "Próximas actividades".
--   * Nadie escribe en `events` directamente: solo a través de
--     apply_calendar_import(), que corre en UNA transacción.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------------

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  full_name  text not null default '',
  created_at timestamptz not null default now()
);
comment on table public.admins is 'Lista blanca de administradores. Solo quien esté aquí puede importar.';

create table if not exists public.events (
  id           uuid primary key default gen_random_uuid(),
  event_id     text not null unique,
  category     text not null check (category in ('SESION', 'GRABACION', 'ENTREGA')),
  type_label   text not null check (type_label in ('SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS', 'GRABACION', 'TRABAJO', 'CUESTIONARIO', 'FORO')),
  title        text not null check (char_length(title) between 1 and 150),
  event_date   date not null,
  start_time   time,
  end_time     time,
  link         text check (link is null or link ~* '^https?://'),
  description  text check (description is null or char_length(description) <= 2000),
  source       text not null default 'excel',
  sort_at      timestamptz not null,
  content_hash text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint events_session_needs_start check (category <> 'SESION' or start_time is not null),
  constraint events_end_after_start check (end_time is null or start_time is null or end_time > start_time),
  constraint events_category_matches_label check (
    (category = 'SESION'    and type_label in ('SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS')) or
    (category = 'GRABACION' and type_label = 'GRABACION') or
    (category = 'ENTREGA'   and type_label in ('TRABAJO', 'CUESTIONARIO', 'FORO'))
  )
);

create index if not exists events_sort_at_idx on public.events (sort_at);
create index if not exists events_event_date_idx on public.events (event_date);
comment on column public.events.source is 'excel = gestionado por importación. La sincronización solo borra filas con source = excel.';

create table if not exists public.imports (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'import' check (kind in ('import', 'restore')),
  admin_id        uuid references auth.users (id) on delete set null,
  admin_email     text,
  file_name       text,
  file_path       text,
  rows_before     int not null default 0,
  rows_after      int not null default 0,
  created_count   int not null default 0,
  updated_count   int not null default 0,
  deleted_count   int not null default 0,
  unchanged_count int not null default 0,
  status          text not null check (status in ('applied', 'failed')),
  error_message   text,
  restored_from   uuid references public.imports (id) on delete set null,
  created_at      timestamptz not null default now()
);
create index if not exists imports_created_at_idx on public.imports (created_at desc);

create table if not exists public.event_snapshots (
  import_id     uuid primary key references public.imports (id) on delete cascade,
  before_events jsonb not null,
  after_events  jsonb not null,
  created_at    timestamptz not null default now()
);
comment on table public.event_snapshots is 'Respaldo: estado completo antes y después de cada importación aplicada.';

create table if not exists public.calendar_state (
  id             boolean primary key default true check (id),
  version        int not null default 0,
  updated_at     timestamptz not null default now(),
  last_import_id uuid references public.imports (id) on delete set null
);
insert into public.calendar_state (id) values (true) on conflict (id) do nothing;

create sequence if not exists public.event_id_seq;

-- ---------------------------------------------------------------------------
-- 2. Funciones
-- ---------------------------------------------------------------------------

-- ¿El usuario de la sesión actual es administrador?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- Huella de contenido de un evento: si cambia cualquier campo visible, cambia la huella.
create or replace function public.event_hash(
  p_category text, p_type_label text, p_title text, p_date date,
  p_start time, p_end time, p_link text, p_description text)
returns text
language sql
immutable
as $$
  select md5(concat_ws('|',
    p_category, p_type_label, p_title, p_date::text,
    coalesce(to_char(p_start, 'HH24:MI'), ''), coalesce(to_char(p_end, 'HH24:MI'), ''),
    coalesce(p_link, ''), coalesce(p_description, '')));
$$;

-- Instante real del evento en Colombia. Entregas sin hora = 23:59 (regla D1).
create or replace function public.event_sort_at(p_date date, p_start time)
returns timestamptz
language sql
immutable
as $$
  select (p_date + coalesce(p_start, time '23:59')) at time zone 'America/Bogota';
$$;

-- -----------------------------------------------------------------------------
-- apply_calendar_import
--   p_rows: arreglo JSON de filas ya validadas por la app, en el orden del Excel:
--     [{ "event_id": "EVT-0001" | null, "type_label": "SESION_ZAJUNA", "title": "...",
--        "event_date": "2026-10-05", "start_time": "08:00" | null,
--        "end_time": "10:00" | null, "link": "https://..." | null,
--        "description": "..." | null }, ...]
--   p_dry_run = true  → solo calcula la vista previa, no cambia nada.
--   p_dry_run = false → aplica TODO en una sola transacción (o nada si falla).
--   p_expected_version: versión vista en la vista previa. Si alguien aplicó
--     otra actualización mientras tanto, se rechaza con VERSION_CONFLICT.
--
-- Errores (la app los traduce a mensajes comprensibles):
--   NOT_ADMIN, EMPTY_IMPORT, VERSION_CONFLICT, DUPLICATE_ID: <ids>, INVALID_PAYLOAD
-- -----------------------------------------------------------------------------
create or replace function public.apply_calendar_import(
  p_rows             jsonb,
  p_expected_version int,
  p_dry_run          boolean default true,
  p_file_name        text default null,
  p_file_path        text default null,
  p_kind             text default 'import',
  p_restored_from    uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version      int;
  v_import_id    uuid;
  v_before       jsonb;
  v_after        jsonb;
  v_before_count int;
  v_total        int;
  v_unchanged    int;
  v_max_num      int;
  v_seq_last     bigint;
  v_seq_called   boolean;
  v_dups         text;
  v_email        text;
  v_created      jsonb;
  v_updated      jsonb;
  v_deleted      jsonb;
  v_applied_at   timestamptz;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  if p_kind not in ('import', 'restore') or jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'INVALID_PAYLOAD';
  end if;

  -- Un Excel vacío borraría todo el calendario: se bloquea (solo una restauración puede dejarlo vacío).
  if jsonb_array_length(p_rows) = 0 and p_kind = 'import' then
    raise exception 'EMPTY_IMPORT';
  end if;

  -- Estado actual (bloqueado solo cuando se va a aplicar).
  if p_dry_run then
    select version into v_version from public.calendar_state where id;
  else
    select version into v_version from public.calendar_state where id for update;
    if p_expected_version is null or v_version <> p_expected_version then
      raise exception 'VERSION_CONFLICT';
    end if;
  end if;

  -- Filas entrantes normalizadas; rn = posición en el archivo.
  drop table if exists pg_temp._incoming;
  create temp table _incoming on commit drop as
  select
    x.ord::int                                                   as rn,
    nullif(upper(btrim(x.r->>'event_id')), '')                   as event_id,
    -- Nombres antiguos (Excel o respaldos viejos): ENTREGA → CUESTIONARIO; CLASE y SESION → SESION_ZAJUNA.
    case upper(btrim(x.r->>'type_label'))
         when 'ENTREGA' then 'CUESTIONARIO'
         when 'CLASE'   then 'SESION_ZAJUNA'
         when 'SESION'  then 'SESION_ZAJUNA'
         else upper(btrim(x.r->>'type_label')) end               as type_label,
    case when upper(btrim(x.r->>'type_label')) in ('CLASE', 'SESION', 'SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS') then 'SESION'
         when upper(btrim(x.r->>'type_label')) = 'GRABACION' then 'GRABACION'
         else 'ENTREGA' end                                      as category,
    btrim(x.r->>'title')                                         as title,
    (x.r->>'event_date')::date                                   as event_date,
    (nullif(x.r->>'start_time', ''))::time                       as start_time,
    (nullif(x.r->>'end_time', ''))::time                         as end_time,
    nullif(btrim(x.r->>'link'), '')                              as link,
    nullif(btrim(x.r->>'description'), '')                       as description,
    nullif(btrim(x.r->>'event_id'), '') is null                  as auto_id
  from jsonb_array_elements(p_rows) with ordinality as x(r, ord);

  -- Defensa en profundidad: IDs repetidos dentro del archivo.
  select string_agg(event_id, ', ') into v_dups
  from (select event_id from _incoming where event_id is not null group by event_id having count(*) > 1) d;
  if v_dups is not null then
    raise exception 'DUPLICATE_ID: %', v_dups;
  end if;

  -- Asignar ID a filas nuevas sin ID (EVT-0001, EVT-0002…), sin chocar con los existentes.
  if not p_dry_run and exists (select 1 from _incoming where event_id is null) then
    select coalesce(max((substring(event_id from '^EVT-(\d+)$'))::int), 0) into v_max_num
    from (select event_id from public.events union all select event_id from _incoming where event_id is not null) x;

    select last_value, is_called into v_seq_last, v_seq_called from public.event_id_seq;
    if v_seq_called then
      v_max_num := greatest(v_max_num, v_seq_last::int);
    end if;
    if v_max_num > 0 then
      perform setval('public.event_id_seq', v_max_num, true);
    end if;

    update _incoming t
       set event_id = s.new_id
      from (
        select q.rn, 'EVT-' || lpad(nextval('public.event_id_seq')::text, 4, '0') as new_id
        from (select rn from _incoming where event_id is null order by rn) q
      ) s
     where t.rn = s.rn;
  end if;

  alter table _incoming add column content_hash text;
  -- Supabase exige WHERE en todo UPDATE (extensión safeupdate).
  update _incoming
     set content_hash = public.event_hash(category, type_label, title, event_date, start_time, end_time, link, description)
   where content_hash is null;

  -- Comparación por ID_EVENTO → listas de la vista previa (y del resultado).
  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', coalesce(i.event_id, 'Nuevo ' || i.rn), 'auto_id', i.auto_id,
           'type_label', i.type_label, 'title', i.title, 'event_date', i.event_date,
           'start_time', to_char(i.start_time, 'HH24:MI'), 'end_time', to_char(i.end_time, 'HH24:MI'))
           order by i.event_date, i.start_time nulls last, i.rn), '[]'::jsonb)
    into v_created
  from _incoming i
  where i.event_id is null or not exists (select 1 from public.events e where e.event_id = i.event_id);

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', i.event_id,
           'before', jsonb_build_object('type_label', e.type_label, 'title', e.title, 'event_date', e.event_date,
                     'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'),
                     'link', e.link, 'description', e.description),
           'after', jsonb_build_object('type_label', i.type_label, 'title', i.title, 'event_date', i.event_date,
                     'start_time', to_char(i.start_time, 'HH24:MI'), 'end_time', to_char(i.end_time, 'HH24:MI'),
                     'link', i.link, 'description', i.description))
           order by i.event_date, i.start_time nulls last, i.rn), '[]'::jsonb)
    into v_updated
  from _incoming i join public.events e on e.event_id = i.event_id
  where e.content_hash <> i.content_hash;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', e.event_id, 'type_label', e.type_label, 'title', e.title, 'event_date', e.event_date,
           'start_time', to_char(e.start_time, 'HH24:MI'), 'end_time', to_char(e.end_time, 'HH24:MI'))
           order by e.event_date, e.start_time nulls last), '[]'::jsonb)
    into v_deleted
  from public.events e
  where e.source = 'excel' and not exists (select 1 from _incoming i where i.event_id = e.event_id);

  select count(*) into v_unchanged
  from _incoming i join public.events e on e.event_id = i.event_id
  where e.content_hash = i.content_hash;

  select count(*) into v_before_count from public.events where source = 'excel';
  select count(*) into v_total from _incoming;

  -- ---------------------------------------------------------------- vista previa
  if p_dry_run then
    return jsonb_build_object(
      'dry_run', true,
      'version', v_version,
      'import_id', null,
      'rows_before', v_before_count,
      'total', v_total,
      'sessions', (select count(*) from _incoming where category = 'SESION'),
      'recordings', (select count(*) from _incoming where category = 'GRABACION'),
      'deliveries', (select count(*) from _incoming where category = 'ENTREGA'),
      'created_count', jsonb_array_length(v_created),
      'updated_count', jsonb_array_length(v_updated),
      'deleted_count', jsonb_array_length(v_deleted),
      'unchanged_count', v_unchanged,
      'created', v_created, 'updated', v_updated, 'deleted', v_deleted,
      'applied_at', null);
  end if;

  -- ------------------------------------------------------------------- aplicar
  select coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'content_hash' - 'sort_at' order by e.sort_at), '[]'::jsonb)
    into v_before
  from public.events e where e.source = 'excel';

  select email into v_email from auth.users where id = auth.uid();

  insert into public.imports (kind, admin_id, admin_email, file_name, file_path, status, restored_from)
  values (p_kind, auth.uid(), v_email, p_file_name, p_file_path, 'applied', p_restored_from)
  returning id, created_at into v_import_id, v_applied_at;

  delete from public.events e
  where e.source = 'excel' and not exists (select 1 from _incoming i where i.event_id = e.event_id);

  update public.events e
     set category     = i.category,
         type_label   = i.type_label,
         title        = i.title,
         event_date   = i.event_date,
         start_time   = i.start_time,
         end_time     = i.end_time,
         link         = i.link,
         description  = i.description,
         source       = 'excel',
         sort_at      = public.event_sort_at(i.event_date, i.start_time),
         content_hash = i.content_hash,
         updated_at   = now()
    from _incoming i
   where e.event_id = i.event_id and e.content_hash <> i.content_hash;

  insert into public.events (event_id, category, type_label, title, event_date, start_time, end_time,
                             link, description, source, sort_at, content_hash)
  select i.event_id, i.category, i.type_label, i.title, i.event_date, i.start_time, i.end_time,
         i.link, i.description, 'excel', public.event_sort_at(i.event_date, i.start_time), i.content_hash
  from _incoming i
  where not exists (select 1 from public.events e where e.event_id = i.event_id);

  select coalesce(jsonb_agg(to_jsonb(e) - 'id' - 'content_hash' - 'sort_at' order by e.sort_at), '[]'::jsonb)
    into v_after
  from public.events e where e.source = 'excel';

  insert into public.event_snapshots (import_id, before_events, after_events)
  values (v_import_id, v_before, v_after);

  update public.imports
     set rows_before = v_before_count, rows_after = v_total,
         created_count = jsonb_array_length(v_created), updated_count = jsonb_array_length(v_updated),
         deleted_count = jsonb_array_length(v_deleted), unchanged_count = v_unchanged
   where id = v_import_id;

  update public.calendar_state
     set version = version + 1, updated_at = now(), last_import_id = v_import_id
   where id;

  -- Retención: se conservan los respaldos de las 30 operaciones aplicadas más recientes.
  delete from public.event_snapshots s
  where s.import_id not in (
    select id from public.imports where status = 'applied' order by created_at desc limit 30);

  return jsonb_build_object(
    'dry_run', false,
    'version', v_version + 1,
    'import_id', v_import_id,
    'rows_before', v_before_count,
    'total', v_total,
    'sessions', (select count(*) from _incoming where category = 'SESION'),
    'recordings', (select count(*) from _incoming where category = 'GRABACION'),
    'deliveries', (select count(*) from _incoming where category = 'ENTREGA'),
    'created_count', jsonb_array_length(v_created),
    'updated_count', jsonb_array_length(v_updated),
    'deleted_count', jsonb_array_length(v_deleted),
    'unchanged_count', v_unchanged,
    'created', v_created, 'updated', v_updated, 'deleted', v_deleted,
    'applied_at', v_applied_at);
end;
$$;

-- -----------------------------------------------------------------------------
-- restore_snapshot: «Deshacer» una importación.
--   Devuelve el calendario al estado que tenía JUSTO ANTES de p_import_id.
--   p_dry_run = true muestra qué cambiaría; false lo aplica (y queda en el historial,
--   así que también se puede deshacer).
-- -----------------------------------------------------------------------------
create or replace function public.restore_snapshot(
  p_import_id        uuid,
  p_expected_version int,
  p_dry_run          boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
  v_when timestamptz;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;

  select s.before_events, i.created_at
    into v_rows, v_when
  from public.event_snapshots s join public.imports i on i.id = s.import_id
  where s.import_id = p_import_id;

  if v_rows is null then
    raise exception 'SNAPSHOT_NOT_FOUND';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'event_id', x.e->>'event_id', 'type_label', x.e->>'type_label', 'title', x.e->>'title',
           'event_date', x.e->>'event_date', 'start_time', left(x.e->>'start_time', 5),
           'end_time', left(x.e->>'end_time', 5), 'link', x.e->>'link', 'description', x.e->>'description')
           order by x.ord), '[]'::jsonb)
    into v_rows
  from jsonb_array_elements(v_rows) with ordinality as x(e, ord);

  return public.apply_calendar_import(
    v_rows, p_expected_version, p_dry_run,
    'Restauración al ' || to_char(v_when at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI'),
    null, 'restore', p_import_id);
end;
$$;

-- Registrar un intento fallido (la app lo llama cuando la transacción se revirtió).
create or replace function public.log_failed_import(p_file_name text, p_error text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ADMIN' using errcode = '42501';
  end if;
  insert into public.imports (kind, admin_id, admin_email, file_name, status, error_message)
  values ('import', auth.uid(), (select email from auth.users where id = auth.uid()),
          p_file_name, 'failed', left(p_error, 500))
  returning id into v_id;
  return v_id;
end;
$$;

-- Consulta liviana para el cron diario: evita que el plan gratuito pause el proyecto.
create or replace function public.keepalive()
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select updated_at from public.calendar_state where id;
$$;

-- Funciones auxiliares con search_path fijo (recomendación del revisor de seguridad de Supabase).
alter function public.event_hash(text, text, text, date, time, time, text, text) set search_path = '';
alter function public.event_sort_at(date, time) set search_path = '';

-- ---------------------------------------------------------------------------
-- 3. Seguridad (RLS y permisos)
-- ---------------------------------------------------------------------------

alter table public.events          enable row level security;
alter table public.admins          enable row level security;
alter table public.imports         enable row level security;
alter table public.event_snapshots enable row level security;
alter table public.calendar_state  enable row level security;

-- Eventos: lectura pública. No existe ninguna política de escritura.
drop policy if exists "Lectura pública de eventos" on public.events;
create policy "Lectura pública de eventos" on public.events
  for select to anon, authenticated using (true);

-- Admins: cada usuario solo ve su propia fila.
drop policy if exists "Cada admin ve su fila" on public.admins;
create policy "Cada admin ve su fila" on public.admins
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "Admins leen historial" on public.imports;
create policy "Admins leen historial" on public.imports
  for select to authenticated using (public.is_admin());

drop policy if exists "Admins leen respaldos" on public.event_snapshots;
create policy "Admins leen respaldos" on public.event_snapshots
  for select to authenticated using (public.is_admin());

-- Estado: versión y fecha de la última actualización (se muestra en la página pública).
drop policy if exists "Admins leen estado" on public.calendar_state;
drop policy if exists "Lectura pública del estado" on public.calendar_state;
create policy "Lectura pública del estado" on public.calendar_state
  for select to anon, authenticated using (true);

-- Doble seguro: nadie desde la API escribe directo en las tablas.
revoke insert, update, delete, truncate on public.events, public.admins, public.imports,
  public.event_snapshots, public.calendar_state from anon, authenticated;

revoke all on function public.apply_calendar_import(jsonb, int, boolean, text, text, text, uuid) from public, anon;
revoke all on function public.restore_snapshot(uuid, int, boolean) from public, anon;
revoke all on function public.log_failed_import(text, text) from public, anon;
revoke all on function public.keepalive() from public;
grant execute on function public.apply_calendar_import(jsonb, int, boolean, text, text, text, uuid) to authenticated;
grant execute on function public.restore_snapshot(uuid, int, boolean) to authenticated;
grant execute on function public.log_failed_import(text, text) to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant execute on function public.keepalive() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Storage: bucket privado para los Excel originales
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('imports', 'imports', false, 5242880,
        array['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'])
on conflict (id) do nothing;

drop policy if exists "Admins suben Excel" on storage.objects;
create policy "Admins suben Excel" on storage.objects
  for insert to authenticated with check (bucket_id = 'imports' and public.is_admin());

drop policy if exists "Admins leen Excel" on storage.objects;
create policy "Admins leen Excel" on storage.objects
  for select to authenticated using (bucket_id = 'imports' and public.is_admin());

drop policy if exists "Admins borran Excel" on storage.objects;
create policy "Admins borran Excel" on storage.objects
  for delete to authenticated using (bucket_id = 'imports' and public.is_admin());

-- ---------------------------------------------------------------------------
-- 5. Actualizaciones para una base ya creada (se puede ejecutar de nuevo)
--    Tipos: SESION_ZAJUNA (prioritaria) · SESION_ADICIONAL · DUDAS (espacio de dudas por chat),
--           todos en vivo con hora de inicio · GRABACION (disponible desde una fecha)
--           · TRABAJO, CUESTIONARIO, FORO (con fecha límite).
--    Nombres antiguos que se convierten: ENTREGA → CUESTIONARIO; CLASE y SESION → SESION_ZAJUNA.
-- ---------------------------------------------------------------------------
alter table public.events drop constraint if exists events_category_check;
alter table public.events drop constraint if exists events_type_label_check;
alter table public.events drop constraint if exists events_category_matches_label;

update public.events
   set type_label   = 'CUESTIONARIO',
       content_hash = public.event_hash(category, 'CUESTIONARIO', title, event_date, start_time, end_time, link, description),
       updated_at   = now()
 where type_label = 'ENTREGA';

update public.events
   set type_label   = 'SESION_ZAJUNA',
       content_hash = public.event_hash(category, 'SESION_ZAJUNA', title, event_date, start_time, end_time, link, description),
       updated_at   = now()
 where type_label in ('CLASE', 'SESION');

alter table public.events add constraint events_category_check
  check (category in ('SESION', 'GRABACION', 'ENTREGA'));
alter table public.events add constraint events_type_label_check
  check (type_label in ('SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS', 'GRABACION', 'TRABAJO', 'CUESTIONARIO', 'FORO'));
alter table public.events add constraint events_category_matches_label check (
  (category = 'SESION'    and type_label in ('SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS')) or
  (category = 'GRABACION' and type_label = 'GRABACION') or
  (category = 'ENTREGA'   and type_label in ('TRABAJO', 'CUESTIONARIO', 'FORO'))
);

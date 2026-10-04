-- =====================================================================
-- Autorizar a un usuario como administrador del calendario.
--
-- Antes: crea el usuario en Supabase → Authentication → Users → Add user
--        (marca "Auto Confirm User"). Luego cambia el correo de abajo y ejecuta.
-- =====================================================================

insert into public.admins (user_id, full_name)
select id, 'Administrador principal'
from auth.users
where email = 'tu-correo@ejemplo.com'
on conflict (user_id) do nothing;

-- Comprobación: debe mostrar una fila con tu correo.
select a.user_id, u.email, a.full_name, a.created_at
from public.admins a
join auth.users u on u.id = a.user_id;

-- Para QUITAR un administrador:
-- delete from public.admins where user_id = (select id from auth.users where email = 'correo@ejemplo.com');

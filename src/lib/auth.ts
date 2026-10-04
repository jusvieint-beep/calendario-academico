import { NextResponse } from 'next/server';
import { createServerSupabase } from './supabase/server';

export async function getAdminContext() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, isAdmin: false, name: '' };

  const { data } = await supabase.from('admins').select('user_id, full_name').eq('user_id', user.id).maybeSingle();
  return {
    supabase,
    user,
    isAdmin: Boolean(data),
    name: (data?.full_name as string | null) || user.email || 'Administrador'
  };
}

/** Para rutas API: devuelve el contexto o una respuesta de error lista para retornar. */
export type AdminContext = Awaited<ReturnType<typeof getAdminContext>>;
export type AdminCheck = { ok: true; ctx: AdminContext } | { ok: false; error: Response };

export async function requireAdmin(): Promise<AdminCheck> {
  const ctx = await getAdminContext();
  if (!ctx.user) return { ok: false, error: jsonError(401, 'Tu sesión expiró. Vuelve a iniciar sesión.') };
  if (!ctx.isAdmin) return { ok: false, error: jsonError(403, 'Tu usuario no tiene permisos de administrador.') };
  return { ok: true, ctx };
}

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: false, message, ...extra }, { status });
}

/** Traduce los errores de las funciones SQL a mensajes comprensibles. */
export function friendlyDbError(raw: string | undefined): string {
  const msg = raw ?? '';
  if (msg.includes('NOT_ADMIN')) return 'Tu usuario no tiene permisos de administrador.';
  if (msg.includes('VERSION_CONFLICT')) {
    return 'El calendario cambió mientras revisabas la vista previa (se aplicó otra actualización). Vuelve a cargar el archivo para ver los cambios actuales.';
  }
  if (msg.includes('EMPTY_IMPORT')) return 'El archivo no tiene eventos. Por seguridad no se permite dejar el calendario vacío.';
  if (msg.includes('DUPLICATE_ID')) return `Hay un ID_EVENTO repetido (${msg.split('DUPLICATE_ID:')[1]?.trim() ?? ''}). Corrígelo y vuelve a cargar el archivo.`;
  if (msg.includes('SNAPSHOT_NOT_FOUND')) return 'Ese respaldo ya no existe. Solo se conservan los últimos 30.';
  if (msg.includes('INVALID_TYPE')) return 'Hay un TIPO no válido. Usa CLASE, SESION, TRABAJO, ENTREGA o FORO.';
  return `No se aplicó ningún cambio. El calendario sigue igual. Detalle técnico: ${msg || 'error desconocido'}`;
}

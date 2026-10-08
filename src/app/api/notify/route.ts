import { NextResponse } from 'next/server';
import { jsonError, requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recordatorio diario por WhatsApp (CallMeBot) del administrador.
 * GET  → estado: activado, número, hora, si hay clave, vista previa del mensaje de mañana y últimos envíos.
 * POST { action: 'save', enabled, phone, sendHour, remindMinutes, apiKey? } → guarda (la clave va cifrada a Supabase Vault).
 * POST { action: 'test' } → envía un mensaje de prueba ahora.
 * Toda la lógica y los permisos están en las funciones SQL notify_* (verifican is_admin()).
 */
const MESSAGES: Record<string, string> = {
  NOT_ADMIN: 'Tu usuario no tiene permisos de administrador.',
  INVALID_PHONE: 'El número no es válido. Escríbelo con indicativo, por ejemplo +57 322 484 2807.',
  INVALID_HOUR: 'La hora no es válida.',
  INVALID_REMIND: 'El tiempo del recordatorio no es válido.',
  INVALID_KEY: 'La clave (apikey) no es válida. Copia solo el número que te envió CallMeBot.',
  TOO_MANY_TESTS: 'Ya enviaste 5 pruebas en la última hora. Espera un poco para no saturar CallMeBot.'
};

const friendly = (raw: string) => {
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k));
  return code ? MESSAGES[code] : `No se pudo completar. Detalle técnico: ${raw}`;
};

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { data, error } = await auth.ctx.supabase.rpc('notify_get_status');
  if (error) return jsonError(500, friendly(error.message));
  return NextResponse.json({ ok: true, status: data });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { supabase } = auth.ctx;

  let body: { action?: string; enabled?: boolean; phone?: string; sendHour?: number; apiKey?: string; remindMinutes?: number | null };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Solicitud no válida.');
  }

  if (body.action === 'test') {
    const { data, error } = await supabase.rpc('notify_send_test');
    if (error) return jsonError(400, friendly(error.message));
    return NextResponse.json({ ok: true, result: data });
  }

  if (body.action === 'save') {
    const { data, error } = await supabase.rpc('notify_save_settings', {
      p_enabled: Boolean(body.enabled),
      p_phone: body.phone ?? null,
      p_send_hour: Number.isInteger(body.sendHour) ? body.sendHour : 20,
      p_apikey: body.apiKey?.trim() ? body.apiKey.trim() : null,
      p_remind_minutes: Number.isInteger(body.remindMinutes) ? body.remindMinutes : null
    });
    if (error) return jsonError(400, friendly(error.message));
    return NextResponse.json({ ok: true, status: data });
  }

  return jsonError(400, 'Acción no válida.');
}

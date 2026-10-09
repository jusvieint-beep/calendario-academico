import { NextResponse } from 'next/server';
import { jsonError, requireAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Recordatorios por WhatsApp (CallMeBot) a uno o varios números.
 * GET → estado: ajustes generales, destinatarios (sin claves), vista previa de mañana y últimos envíos.
 * POST { action: 'general', enabled, sendHour, remindMinutes }            → activar, hora del resumen y aviso previo.
 * POST { action: 'recipient', id?, label, phone, apiKey?, enabled }       → agregar (sin id) o editar un número.
 * POST { action: 'archive', id }                                          → quitar un número (se conserva su historial).
 * POST { action: 'test', id? }                                            → prueba a todos los activos o a uno.
 * Toda la lógica y los permisos están en las funciones SQL notify_* (verifican is_admin()).
 * Las claves se guardan cifradas en Supabase Vault y nunca se devuelven al navegador.
 */
const MESSAGES: Record<string, string> = {
  NOT_ADMIN: 'Tu usuario no tiene permisos de administrador.',
  INVALID_PHONE: 'El número no es válido. Escríbelo con indicativo, por ejemplo +57 322 484 2807.',
  INVALID_HOUR: 'La hora no es válida.',
  INVALID_REMIND: 'El tiempo del recordatorio no es válido.',
  INVALID_LABEL: 'Escribe un nombre para el número (máximo 40 caracteres), por ejemplo «Mi otro celular».',
  INVALID_KEY: 'La clave (apikey) no es válida. Copia solo el número que envió CallMeBot.',
  KEY_REQUIRED: 'Para agregar un número necesitas su clave (apikey) de CallMeBot.',
  DUPLICATE_PHONE: 'Ese número ya está en la lista.',
  NOT_FOUND: 'Ese número ya no existe. Recarga la página.',
  SETUP_PENDING: 'Falta un paso de configuración en Supabase para recibir en varios números. Pídele a quien administra el sistema que lo complete (ver README, sección de WhatsApp).',
  TOO_MANY_TESTS: 'Ya se enviaron 8 pruebas en la última hora. Espera un poco para no saturar CallMeBot.'
};

const friendly = (raw: string) => {
  const code = Object.keys(MESSAGES).find((k) => raw.includes(k));
  return code ? MESSAGES[code] : `No se pudo completar. Detalle técnico: ${raw}`;
};

const intOrNull = (v: unknown) => (Number.isInteger(v) ? (v as number) : null);

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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Solicitud no válida.');
  }

  let call: { fn: string; args: Record<string, unknown> } | null = null;
  switch (body.action) {
    case 'general':
      call = { fn: 'notify_save_general', args: { p_enabled: Boolean(body.enabled), p_send_hour: intOrNull(body.sendHour) ?? 20, p_remind_minutes: intOrNull(body.remindMinutes) } };
      break;
    case 'recipient':
      call = {
        fn: 'notify_save_recipient',
        args: {
          p_id: intOrNull(body.id),
          p_label: typeof body.label === 'string' ? body.label : '',
          p_phone: typeof body.phone === 'string' ? body.phone : '',
          p_apikey: typeof body.apiKey === 'string' && body.apiKey.trim() ? body.apiKey.trim() : null,
          p_enabled: body.enabled !== false
        }
      };
      break;
    case 'archive':
      if (!intOrNull(body.id)) return jsonError(400, 'Número no válido.');
      call = { fn: 'notify_archive_recipient', args: { p_id: body.id } };
      break;
    case 'test':
      call = { fn: 'notify_test_recipient', args: { p_id: intOrNull(body.id) } };
      break;
  }
  if (!call) return jsonError(400, 'Acción no válida.');

  const { data, error } = await supabase.rpc(call.fn, call.args);
  if (error) return jsonError(400, friendly(error.message));
  return body.action === 'test'
    ? NextResponse.json({ ok: true, results: (data as { results: unknown[] }).results })
    : NextResponse.json({ ok: true, status: data });
}

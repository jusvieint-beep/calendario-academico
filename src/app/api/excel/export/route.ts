import { jsonError, requireAdmin } from '@/lib/auth';
import { fetchEvents } from '@/lib/data';
import { nowInBogota } from '@/lib/dates';
import { buildCalendarWorkbook, XLSX_MIME } from '@/lib/excel/write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** «Excel actual»: todos los eventos con sus ID, para editar y volver a subir. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { ctx } = auth;

  try {
    const events = await fetchEvents(ctx.supabase);
    const buffer = await buildCalendarWorkbook(events);
    const today = nowInBogota().date;
    return new Response(new Uint8Array(buffer), {
      headers: {
        'Content-Type': XLSX_MIME,
        'Content-Disposition': `attachment; filename="calendario_actual_${today}.xlsx"`,
        'Cache-Control': 'no-store'
      }
    });
  } catch (e) {
    return jsonError(500, `No se pudo generar el Excel: ${(e as Error).message}`);
  }
}

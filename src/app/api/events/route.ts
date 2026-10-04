import { NextResponse } from 'next/server';
import { fetchEvents } from '@/lib/data';
import { createPublicSupabase } from '@/lib/supabase/server';

export const revalidate = 300;

/**
 * Lectura pública en JSON (solo lectura). Pensada para integraciones futuras,
 * por ejemplo recordatorios por WhatsApp desde Make.com.
 */
export async function GET() {
  try {
    const events = await fetchEvents(createPublicSupabase());
    return NextResponse.json({ timezone: 'America/Bogota', count: events.length, events });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

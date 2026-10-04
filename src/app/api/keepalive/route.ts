import { NextResponse } from 'next/server';
import { createPublicSupabase } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Llamado una vez al día por el cron de Vercel (vercel.json).
 * Una consulta liviana evita que el plan gratuito de Supabase pause el proyecto
 * por inactividad.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const { data, error } = await createPublicSupabase().rpc('keepalive');
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, lastUpdate: data });
}

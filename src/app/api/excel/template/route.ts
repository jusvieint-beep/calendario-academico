import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Plantilla vacía oficial.
 * El archivo vive en public/plantilla-calendario.xlsx y se genera con
 * scripts/generar_plantilla.py (incluye listas desplegables, formatos e instrucciones).
 * No contiene datos, así que puede servirse como archivo estático.
 */
export function GET(request: Request) {
  return NextResponse.redirect(new URL('/plantilla-calendario.xlsx', request.url), { status: 307 });
}

import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { friendlyDbError, jsonError, requireAdmin } from '@/lib/auth';
import type { SyncResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Restaura el calendario al estado guardado antes de una importación. */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { ctx } = auth;

  let body: { importId?: string; expectedVersion?: number; dryRun?: boolean };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Solicitud no válida.');
  }
  if (!body.importId || !/^[0-9a-f-]{36}$/i.test(body.importId)) return jsonError(400, 'Respaldo no válido.');

  const dryRun = body.dryRun !== false;
  const { data, error: rpcError } = await ctx.supabase.rpc('restore_snapshot', {
    p_import_id: body.importId,
    p_expected_version: dryRun ? null : body.expectedVersion ?? null,
    p_dry_run: dryRun
  });
  if (rpcError) return jsonError(409, friendlyDbError(rpcError.message));

  if (!dryRun) revalidatePath('/');
  return NextResponse.json({ ok: true, result: data as SyncResult });
}

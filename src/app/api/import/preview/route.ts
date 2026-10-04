import { NextResponse } from 'next/server';
import { friendlyDbError, jsonError, requireAdmin } from '@/lib/auth';
import { readImportRequest } from '@/lib/excel/process';
import type { SyncResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Valida un Excel subido o las filas del editor web y calcula la vista previa
 * (simulación). No modifica ningún dato.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { ctx } = auth;

  const input = await readImportRequest(request);
  if (!input.ok) return jsonError(400, input.message);
  const { check } = input;

  if (!check.ok) {
    return NextResponse.json({ ok: false, stage: 'validation', fileName: check.fileName, errors: check.errors, warnings: check.warnings });
  }

  const { data, error: rpcError } = await ctx.supabase.rpc('apply_calendar_import', {
    p_rows: check.rows,
    p_expected_version: null,
    p_dry_run: true
  });
  if (rpcError) return jsonError(400, friendlyDbError(rpcError.message));

  return NextResponse.json({
    ok: true,
    stage: 'preview',
    fileName: check.fileName,
    warnings: check.warnings,
    result: data as SyncResult
  });
}

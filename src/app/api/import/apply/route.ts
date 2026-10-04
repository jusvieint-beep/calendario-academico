import { revalidatePath } from 'next/cache';
import { NextResponse } from 'next/server';
import { friendlyDbError, jsonError, requireAdmin } from '@/lib/auth';
import { readImportRequest } from '@/lib/excel/process';
import { XLSX_MIME } from '@/lib/excel/write';
import type { SyncResult } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Confirma la actualización (Excel subido o editor web).
 * Vuelve a validar los mismos datos, guarda el Excel original en Storage (si lo hay)
 * y aplica todos los cambios en UNA transacción de Postgres (apply_calendar_import).
 * Si algo falla, no queda ningún cambio a medias.
 */
export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.error;
  const { ctx } = auth;
  const { supabase } = ctx;

  const input = await readImportRequest(request);
  if (!input.ok) return jsonError(400, input.message);
  const { check, source, expectedVersion } = input;

  if (expectedVersion === null) {
    return jsonError(400, 'Falta la versión de la vista previa. Vuelve a revisar los cambios.');
  }
  if (!check.ok) {
    return NextResponse.json({ ok: false, stage: 'validation', fileName: check.fileName, errors: check.errors, warnings: check.warnings }, { status: 400 });
  }

  // 1. Guarda el Excel original (respaldo del archivo). El editor web no tiene archivo:
  //    su respaldo es la foto completa del calendario que guarda la función SQL.
  let storedPath: string | null = null;
  if (source === 'excel' && check.buffer) {
    const safeName = check.fileName.replace(/[^\w.\-]+/g, '_');
    const filePath = `${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}-${safeName}`;
    const upload = await supabase.storage.from('imports').upload(filePath, new Uint8Array(check.buffer), {
      contentType: XLSX_MIME,
      upsert: false
    });
    storedPath = upload.error ? null : filePath;
  }

  // 2. Aplica todo o nada.
  const { data, error: rpcError } = await supabase.rpc('apply_calendar_import', {
    p_rows: check.rows,
    p_expected_version: expectedVersion,
    p_dry_run: false,
    p_file_name: check.fileName,
    p_file_path: storedPath
  });

  if (rpcError) {
    if (storedPath) await supabase.storage.from('imports').remove([storedPath]);
    const message = friendlyDbError(rpcError.message);
    await supabase.rpc('log_failed_import', { p_file_name: check.fileName, p_error: rpcError.message });
    return jsonError(409, message, { code: rpcError.message.includes('VERSION_CONFLICT') ? 'VERSION_CONFLICT' : 'FAILED' });
  }

  revalidatePath('/');
  return NextResponse.json({
    ok: true,
    result: data as SyncResult,
    fileStored: source === 'web' ? true : Boolean(storedPath),
    admin: ctx.name
  });
}

import type { RowIssue } from '../types';
import { nowInBogota } from '../dates';
import { MAX_FILE_BYTES } from './columns';
import { checkGridRows, type UploadCheck } from './check-grid';
import { readCalendarWorkbook } from './read';
import { validateRows } from './validate';

export { checkGridRows, WEB_SOURCE_NAME, type UploadCheck } from './check-grid';

const fileIssue = (message: string, fix: string): RowIssue => ({ row: 0, column: 'Archivo', value: '', message, fix });

/** Lee, valida y normaliza el Excel subido. Nunca toca la base de datos. */
export async function checkUpload(file: unknown): Promise<UploadCheck> {
  if (!file || typeof file !== 'object' || typeof (file as File).arrayBuffer !== 'function') {
    return { ok: false, fileName: '', warnings: [], errors: [fileIssue('No se recibió ningún archivo.', 'Selecciona o arrastra un archivo .xlsx.')] };
  }
  const f = file as File;
  const fileName = (f.name || 'archivo.xlsx').slice(0, 200);

  if (!/\.xlsx$/i.test(fileName)) {
    return { ok: false, fileName, warnings: [], errors: [fileIssue(`«${fileName}» no es un archivo .xlsx.`, 'En Excel usa Archivo → Guardar como → «Libro de Excel (.xlsx)».')] };
  }
  if (f.size > MAX_FILE_BYTES) {
    return { ok: false, fileName, warnings: [], errors: [fileIssue('El archivo pesa más de 4 MB.', 'Elimina hojas, imágenes o filas vacías con formato y vuelve a guardarlo.')] };
  }

  const buffer = await f.arrayBuffer();
  const read = await readCalendarWorkbook(buffer);
  if (read.errors.length) return { ok: false, fileName, warnings: [], errors: read.errors };

  const result = validateRows(read.raw, nowInBogota().date);
  if (result.errors.length) return { ok: false, fileName, warnings: result.warnings, errors: result.errors };
  return { ok: true, fileName, rows: result.rows, warnings: result.warnings, buffer };
}

export type ImportInput =
  | { ok: true; source: 'excel' | 'web'; check: UploadCheck; expectedVersion: number | null }
  | { ok: false; message: string };

function toVersion(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
}

/**
 * Lee la solicitud de vista previa o de aplicación.
 *  - multipart/form-data con `file` (y `expectedVersion`) → archivo Excel
 *  - application/json con `rows` (y `expectedVersion`)   → editor web
 */
export async function readImportRequest(request: Request): Promise<ImportInput> {
  const type = request.headers.get('content-type') ?? '';

  if (type.includes('application/json')) {
    let body: { rows?: unknown; expectedVersion?: unknown };
    try {
      body = await request.json();
    } catch {
      return { ok: false, message: 'Solicitud no válida. Recarga la página e inténtalo de nuevo.' };
    }
    return { ok: true, source: 'web', check: checkGridRows(body?.rows), expectedVersion: toVersion(body?.expectedVersion) };
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return { ok: false, message: 'No se pudo leer el archivo enviado. Inténtalo de nuevo.' };
  }
  return { ok: true, source: 'excel', check: await checkUpload(form.get('file')), expectedVersion: toVersion(form.get('expectedVersion')) };
}

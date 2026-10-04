import type { ImportRow, RowIssue } from '../types';
import { nowInBogota } from '../dates';
import { COLUMNS, MAX_ROWS, type ColumnKey } from './columns';
import { validateRows, type RawRow } from './validate';

export type UploadCheck =
  | { ok: true; rows: ImportRow[]; warnings: RowIssue[]; fileName: string; buffer?: ArrayBuffer }
  | { ok: false; errors: RowIssue[]; warnings: RowIssue[]; fileName: string };

/** Nombre con el que aparecen en el historial los cambios hechos en el editor web. */
export const WEB_SOURCE_NAME = 'Edición en la plataforma';

const MAX_CELL_CHARS = 5000;

/**
 * Valida las filas que llegan del editor web. Cada fila es un objeto con las mismas
 * columnas del Excel, como texto. Se numeran 1, 2, 3… igual que en el editor.
 * Usa exactamente las mismas reglas que un archivo subido.
 */
export function checkGridRows(input: unknown): UploadCheck {
  const fileName = WEB_SOURCE_NAME;
  if (!Array.isArray(input)) {
    return { ok: false, fileName, warnings: [], errors: [{ row: 0, column: 'Tabla', value: '', message: 'No se recibieron filas.', fix: 'Recarga la página e inténtalo de nuevo.' }] };
  }
  if (input.length > MAX_ROWS * 2) {
    return { ok: false, fileName, warnings: [], errors: [{ row: 0, column: 'Tabla', value: String(input.length), message: `La tabla tiene ${input.length} filas; el máximo es ${MAX_ROWS}.`, fix: 'Elimina filas vacías o eventos antiguos.' }] };
  }

  const raw: RawRow[] = input.map((item, i) => {
    const o = item && typeof item === 'object' ? (item as Record<string, unknown>) : {};
    const cells = {} as Record<ColumnKey, unknown>;
    for (const col of COLUMNS) {
      const v = o[col.key];
      cells[col.key] = v === null || v === undefined ? null : String(v).slice(0, MAX_CELL_CHARS);
    }
    return { row: i + 1, cells };
  });

  const result = validateRows(raw, nowInBogota().date);
  const errors = result.errors.map((e) =>
    e.row === 0 && e.message.includes('no tiene filas')
      ? { ...e, column: 'Tabla', message: 'La tabla no tiene eventos.', fix: 'Agrega al menos una fila. Por seguridad no se permite dejar el calendario vacío.' }
      : e
  );
  if (errors.length) return { ok: false, fileName, warnings: result.warnings, errors };
  return { ok: true, fileName, rows: result.rows, warnings: result.warnings };
}

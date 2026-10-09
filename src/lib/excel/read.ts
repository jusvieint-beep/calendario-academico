import ExcelJS from 'exceljs';
import type { RowIssue } from '../types';
import { COLUMNS, SHEET_NAME, normalizeHeader, type ColumnKey } from './columns';
import type { RawRow } from './validate';

export interface ReadResult {
  raw: RawRow[];
  errors: RowIssue[];
}

const fileError = (message: string, fix: string): RowIssue => ({ row: 0, column: 'Archivo', value: '', message, fix });

/** Lee la hoja «Calendario» y devuelve las filas con sus celdas por columna. */
export async function readCalendarWorkbook(buffer: ArrayBuffer): Promise<ReadResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return {
      raw: [],
      errors: [fileError('El archivo no es un Excel válido o está dañado.', 'Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».')]
    };
  }

  const wanted = normalizeHeader(SHEET_NAME);
  const sheet = workbook.worksheets.find((ws) => normalizeHeader(ws.name) === wanted);
  if (!sheet) {
    const names = workbook.worksheets.map((ws) => `«${ws.name}»`).join(', ') || 'ninguna';
    return {
      raw: [],
      errors: [fileError(`No se encontró la hoja «${SHEET_NAME}». Hojas en el archivo: ${names}.`, `Usa la plantilla oficial o renombra la hoja de datos como «${SHEET_NAME}».`)]
    };
  }

  // Encabezados en la fila 1.
  const headerRow = sheet.getRow(1);
  const positions = new Map<ColumnKey, number>();
  const known = new Set(COLUMNS.map((c) => c.key));
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const name = normalizeHeader(String(cell.text ?? cell.value ?? ''));
    if (known.has(name as ColumnKey) && !positions.has(name as ColumnKey)) positions.set(name as ColumnKey, colNumber);
  });

  const missing = COLUMNS.filter((c) => !c.optionalHeader && !positions.has(c.key)).map((c) => c.key);
  if (missing.length) {
    return {
      raw: [],
      errors: [fileError(
        `Faltan columnas en la fila 1: ${missing.join(', ')}.`,
        'No cambies ni borres los encabezados. Descarga la plantilla oficial si es necesario.'
      )]
    };
  }

  const raw: RawRow[] = [];
  const last = sheet.rowCount;
  for (let r = 2; r <= last; r++) {
    const row = sheet.getRow(r);
    const cells = {} as Record<ColumnKey, unknown>;
    for (const col of COLUMNS) {
      const pos = positions.get(col.key);
      // Columna opcional ausente (archivo antiguo): undefined = «no viene en el archivo».
      cells[col.key] = pos === undefined ? undefined : row.getCell(pos).value;
    }
    raw.push({ row: r, cells });
  }
  return { raw, errors: [] };
}

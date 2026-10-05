/**
 * Lógica pura del editor tipo Excel del panel /admin.
 * No depende de React ni del navegador, para poder probarla (tests/grid.test.ts).
 *
 * Las celdas viajan como texto, igual que si se escribieran en Excel. El servidor
 * las valida con exactamente las mismas reglas que un archivo subido.
 */
import { COLUMNS, normalizeHeader, type ColumnKey } from './excel/columns';
import { parseDateCell, parseTimeCell } from './excel/normalize';
import { addDays, formatDateShort } from './dates';
import { TYPE_ALIASES, TYPE_LABELS, type CalendarEvent, type TypeLabel } from './types';

export type GridCells = Record<ColumnKey, string>;

export const COLUMN_KEYS: ColumnKey[] = COLUMNS.map((c) => c.key);

export function emptyCells(): GridCells {
  return Object.fromEntries(COLUMN_KEYS.map((k) => [k, ''])) as GridCells;
}

export function eventToCells(e: CalendarEvent): GridCells {
  return {
    ID_EVENTO: e.event_id,
    TIPO: e.type_label,
    NOMBRE: e.title,
    FECHA: formatDateShort(e.event_date),
    HORA_INICIO: e.start_time ?? '',
    HORA_FIN: e.end_time ?? '',
    LINK: e.link ?? '',
    DESCRIPCION: e.description ?? ''
  };
}

export const isBlankRow = (c: GridCells) => COLUMN_KEYS.every((k) => c[k].trim() === '');

export const sameCells = (a: GridCells, b: GridCells) => COLUMN_KEYS.every((k) => a[k].trim() === b[k].trim());

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** 'sesión', 'Grabación', 'clase', 'Entrega' → 'SESION', 'GRABACION', 'SESION', 'CUESTIONARIO'. Si no es un tipo conocido, devuelve el texto tal cual. */
export function normalizeType(value: string): string {
  const t = stripAccents(value).trim().toUpperCase();
  if (TYPE_ALIASES[t]) return TYPE_ALIASES[t];
  return (TYPE_LABELS as readonly string[]).includes(t) ? (t as TypeLabel) : value.trim();
}

export const isKnownType = (value: string) => (TYPE_LABELS as readonly string[]).includes(value);

/**
 * Convierte el texto que Excel o Google Sheets ponen en el portapapeles
 * (columnas separadas por tabulador, filas por salto de línea, celdas con
 * saltos de línea entre comillas) en una matriz de celdas.
 */
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === '\t') {
      row.push(cell); cell = '';
    } else if (ch === '\n') {
      row.push(cell); rows.push(row); row = []; cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  // Excel agrega un salto de línea final: no crea una fila extra.
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop();
  return rows;
}

/** ¿El texto pegado ocupa más de una celda? */
export const isMultiCellPaste = (text: string) => /[\t\n]/.test(text.replace(/\r?\n$/, ''));

/** Si la primera fila pegada son los encabezados de la plantilla, se descarta. */
export function dropHeaderRow(matrix: string[][]): string[][] {
  if (!matrix.length) return matrix;
  const first = matrix[0].map((c) => normalizeHeader(c));
  const hits = first.filter((c) => (COLUMN_KEYS as string[]).includes(c)).length;
  return hits >= 3 ? matrix.slice(1) : matrix;
}

/**
 * Convierte filas copiadas de Excel en filas nuevas del editor («Pegar desde Excel»).
 *  - Con fila de encabezados: cada columna se ubica por su nombre (sirve aunque el orden cambie).
 *  - Sin encabezados: 8 o más columnas = empieza en ID_EVENTO; menos = empieza en TIPO
 *    (lo usual es copiar sin la columna de ID).
 */
export function matrixToCells(matrix: string[][]): GridCells[] {
  if (!matrix.length) return [];
  const header = matrix[0].map((c) => normalizeHeader(c));
  const hasHeader = header.filter((c) => (COLUMN_KEYS as string[]).includes(c)).length >= 3;

  let keyAt: (col: number) => ColumnKey | undefined;
  let data = matrix;
  if (hasHeader) {
    keyAt = (col) => ((COLUMN_KEYS as string[]).includes(header[col]) ? (header[col] as ColumnKey) : undefined);
    data = matrix.slice(1);
  } else {
    const width = Math.max(...matrix.map((r) => r.length));
    const offset = width >= COLUMN_KEYS.length ? 0 : 1;
    keyAt = (col) => COLUMN_KEYS[col + offset];
  }

  return data
    .map((values) => {
      const cells = emptyCells();
      values.forEach((raw, col) => {
        const key = keyAt(col);
        if (key) cells[key] = key === 'TIPO' ? normalizeType(raw) : raw.trim();
      });
      return cells;
    })
    .filter((c) => !isBlankRow(c));
}

/**
 * Escribe una matriz pegada sobre las filas, empezando en (fila, columna).
 * Agrega filas nuevas al final si hace falta. Devuelve una copia.
 * `isNew(i)` indica si la fila i es nueva: el ID de filas existentes nunca se sobrescribe.
 */
export function applyPaste(
  rows: GridCells[],
  startRow: number,
  startCol: number,
  matrix: string[][],
  isNew: (index: number) => boolean
): { rows: GridCells[]; added: number; touched: number } {
  const out = rows.map((r) => ({ ...r }));
  let added = 0;
  let touched = 0;
  matrix.forEach((values, dr) => {
    const r = startRow + dr;
    if (r >= out.length) { out.push(emptyCells()); added++; }
    values.forEach((raw, dc) => {
      const key = COLUMN_KEYS[startCol + dc];
      if (!key) return;
      if (key === 'ID_EVENTO' && !(r >= rows.length || isNew(r))) return;
      out[r][key] = key === 'TIPO' ? normalizeType(raw) : raw.trim();
    });
    touched++;
  });
  return { rows: out, added, touched };
}

/** Copia de una fila para la semana siguiente: sin ID y con la fecha + 7 días. */
export function nextWeekCopy(c: GridCells): GridCells {
  const copy = { ...c, ID_EVENTO: '' };
  const d = parseDateCell(c.FECHA);
  if (d.ok) copy.FECHA = formatDateShort(addDays(d.value, 7));
  return copy;
}

/** Clave para ordenar por fecha y hora. Filas sin fecha válida van al final. */
export function sortKey(c: GridCells): string {
  const d = parseDateCell(c.FECHA);
  if (!d.ok) return '9999-99-99';
  const t = parseTimeCell(c.HORA_INICIO);
  return `${d.value}T${t.ok && t.value ? t.value : '23:59'}`;
}

/** Fecha de la fila en formato YYYY-MM-DD, o null si no es válida. */
export function rowDate(c: GridCells): string | null {
  const d = parseDateCell(c.FECHA);
  return d.ok ? d.value : null;
}

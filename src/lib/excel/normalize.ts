/**
 * Conversión de valores de celda de Excel a texto, fecha (YYYY-MM-DD) y hora (HH:MM).
 * Funciones puras: no dependen de la librería de Excel, para poder probarlas.
 *
 * Excel guarda fechas como número de días desde 1899-12-30 y horas como fracción del día.
 * Se calculan siempre en UTC para que ninguna zona horaria mueva la fecha.
 */

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;

type Parsed<T> = { ok: true; value: T } | { ok: false };

/** Texto visible de una celda (texto, número, enlace, texto enriquecido o fórmula). */
export function cellToText(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('').trim();
    if ('result' in o) return cellToText(o.result);
    if (typeof o.text === 'string') return o.text.trim();
    if (o.text && typeof o.text === 'object') return cellToText(o.text);
    if ('error' in o) return String(o.error);
  }
  return String(v).trim();
}

/** Para la columna LINK: si la celda es un hipervínculo, se usa la dirección real. */
export function cellToLink(v: unknown): string {
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    const o = v as Record<string, unknown>;
    if (typeof o.hyperlink === 'string' && o.hyperlink.trim()) return o.hyperlink.trim();
  }
  return cellToText(v);
}

function unwrap(v: unknown): unknown {
  if (v && typeof v === 'object' && !(v instanceof Date) && 'result' in (v as object)) {
    return (v as { result: unknown }).result;
  }
  return v;
}

export function isEmptyCell(v: unknown): boolean {
  return cellToText(v) === '';
}

function validYmd(y: number, m: number, d: number): boolean {
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

export function parseDateCell(raw: unknown): Parsed<string> {
  const v = unwrap(raw);
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { ok: false };
    const y = v.getUTCFullYear(), m = v.getUTCMonth() + 1, d = v.getUTCDate();
    return validYmd(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false };
  }
  if (typeof v === 'number' && isFinite(v)) {
    const dt = new Date(EXCEL_EPOCH_MS + Math.floor(v) * DAY_MS);
    const y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, d = dt.getUTCDate();
    return validYmd(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false };
  }
  const s = cellToText(v);
  let match = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})$/);
  if (match) {
    const d = +match[1], m = +match[2], y = +match[3];
    return validYmd(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false };
  }
  match = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:T.*)?$/);
  if (match) {
    const y = +match[1], m = +match[2], d = +match[3];
    return validYmd(y, m, d) ? { ok: true, value: ymd(y, m, d) } : { ok: false };
  }
  return { ok: false };
}

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Devuelve null si la celda está vacía. */
export function parseTimeCell(raw: unknown): Parsed<string | null> {
  const v = unwrap(raw);
  if (v === null || v === undefined || cellToText(v) === '') return { ok: true, value: null };
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return { ok: false };
    const ms = ((v.getTime() % DAY_MS) + DAY_MS) % DAY_MS;
    return { ok: true, value: hhmm(Math.min(Math.round(ms / 60_000), 1439)) };
  }
  if (typeof v === 'number' && isFinite(v)) {
    if (v < 0) return { ok: false };
    const frac = v - Math.floor(v);
    if (v >= 1 && frac === 0) return { ok: false };
    return { ok: true, value: hhmm(Math.min(Math.round(frac * 1440), 1439)) };
  }
  let s = cellToText(v).toLowerCase().replace(/\s+/g, ' ').trim();
  let meridiem: 'am' | 'pm' | null = null;
  const mer = s.match(/\s*([ap])\.?\s?m\.?$/);
  if (mer) {
    meridiem = mer[1] === 'a' ? 'am' : 'pm';
    s = s.slice(0, mer.index).trim();
  }
  const m = s.match(/^(\d{1,2})(?:[:h.](\d{2}))?(?::(\d{2}))?$/);
  if (!m) return { ok: false };
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (!m[2] && !meridiem) return { ok: false };
  if (min > 59) return { ok: false };
  if (meridiem) {
    if (h < 1 || h > 12) return { ok: false };
    if (meridiem === 'am' && h === 12) h = 0;
    if (meridiem === 'pm' && h !== 12) h += 12;
  } else if (h > 23) {
    return { ok: false };
  }
  return { ok: true, value: hhmm(h * 60 + min) };
}

/** Muestra un valor de celda en un mensaje de error. */
export function displayValue(raw: unknown): string {
  const v = unwrap(raw);
  if (v instanceof Date && !isNaN(v.getTime())) {
    const iso = v.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
  }
  const s = cellToText(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

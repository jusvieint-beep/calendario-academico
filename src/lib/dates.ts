/**
 * Fechas y horas en hora de Colombia (America/Bogota, UTC-5, sin horario de verano).
 *
 * Regla: las fechas viajan siempre como texto 'YYYY-MM-DD' y las horas como 'HH:MM'.
 * Nunca se convierten a Date local del navegador, así "5 de octubre" no se vuelve 4.
 */
export const TZ = 'America/Bogota';
export const OFFSET = '-05:00';

export const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
export const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const WEEKDAYS_LONG = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const WEEKDAYS_SHORT = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

export interface NowCol {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
}

export function nowInBogota(at: Date = new Date()): NowCol {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(at);
  const p: Record<string, string> = {};
  for (const x of parts) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function addDays(date: string, n: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  return iso(new Date(Date.UTC(y, m - 1 + n, 1))).slice(0, 7);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = lunes … 6 = domingo */
export function weekdayMondayFirst(date: string): number {
  return (utc(date).getUTCDay() + 6) % 7;
}

export function dayOfMonth(date: string): number {
  return utc(date).getUTCDate();
}

export function dayName(date: string): string {
  return DAYS[utc(date).getUTCDay()];
}

export function addMinutes(time: string, n: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + n, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 'YYYY-MM-DDTHH:MM' en hora de Colombia → milisegundos reales. */
export function keyToMs(key: string): number {
  return Date.parse(`${key}:00${OFFSET}`);
}

/** '14:00' → '2:00 PM' */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const suffix = h < 12 ? 'AM' : 'PM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** '2026-10-05' → 'lunes 5 de octubre' (o '5 de octubre' sin día) */
export function formatDate(date: string, withWeekday = true, withYear = false): string {
  const d = utc(date);
  const base = `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}${withYear ? ` de ${d.getUTCFullYear()}` : ''}`;
  return withWeekday ? `${DAYS[d.getUTCDay()]} ${base}` : base;
}

/** '2026-10-05' → '05/10/2026' */
export function formatDateShort(date: string): string {
  const [y, m, d] = date.split('-');
  return `${d}/${m}/${y}`;
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Instante ISO (timestamptz) → fecha y hora legibles en Colombia. */
export function formatInstant(isoString: string): string {
  const n = nowInBogota(new Date(isoString));
  return `${capitalize(formatDate(n.date, false, true))} · ${formatTime(n.time)}`;
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

import type { CalendarEvent } from './types';
import { addMinutes, capitalize, formatDate, formatTime, keyToMs, type NowCol } from './dates';

/**
 * Reglas aprobadas (D1 y D6):
 *  - Una entrega sin hora vence a las 23:59 y se ordena como 23:59.
 *  - Una clase sigue visible hasta su hora de fin; sin hora de fin, 1 hora después del inicio.
 */
export const DEFAULT_DUE = '23:59';
export const SESSION_DEFAULT_MINUTES = 60;
export const DUE_SOON_HOURS = 48;
export const UPCOMING_LIMIT = 5;

export const startKey = (e: CalendarEvent) => `${e.event_date}T${e.start_time ?? DEFAULT_DUE}`;

export function endKey(e: CalendarEvent): string {
  if (e.category === 'SESION') {
    const start = e.start_time ?? '00:00';
    return `${e.event_date}T${e.end_time ?? addMinutes(start, SESSION_DEFAULT_MINUTES)}`;
  }
  return `${e.event_date}T${e.start_time ?? DEFAULT_DUE}`;
}

export const nowKey = (now: NowCol) => `${now.date}T${now.time}`;
export const isPast = (e: CalendarEvent, now: NowCol) => endKey(e) <= nowKey(now);
export const isLive = (e: CalendarEvent, now: NowCol) =>
  e.category === 'SESION' && startKey(e) <= nowKey(now) && !isPast(e, now);

/** Orden por fecha y hora real; a igual hora, la sesión va primero. */
export function compareEvents(a: CalendarEvent, b: CalendarEvent): number {
  const ka = startKey(a), kb = startKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  if (a.category !== b.category) return a.category === 'SESION' ? -1 : 1;
  return a.title.localeCompare(b.title, 'es');
}

export function upcoming(events: CalendarEvent[], now: NowCol, limit = UPCOMING_LIMIT): CalendarEvent[] {
  return events.filter((e) => !isPast(e, now)).sort(compareEvents).slice(0, limit);
}

export function kindName(e: Pick<CalendarEvent, 'type_label'>): string {
  switch (e.type_label) {
    case 'CLASE': return 'Clase';
    case 'SESION': return 'Sesión';
    case 'TRABAJO': return 'Trabajo';
    default: return 'Entrega';
  }
}

export type DeliveryStatus = 'pendiente' | 'pronto' | 'vencido';

export function deliveryStatus(e: CalendarEvent, now: NowCol, nowMs = Date.now()): { status: DeliveryStatus; label: string } {
  if (isPast(e, now)) return { status: 'vencido', label: 'Vencido' };
  const hours = (keyToMs(endKey(e)) - nowMs) / 36e5;
  if (hours < DUE_SOON_HOURS) {
    const label = hours < 1 ? 'Vence en menos de 1 hora' : hours < 24 ? `Vence en ${Math.round(hours)} h` : 'Vence mañana';
    return { status: 'pronto', label };
  }
  return { status: 'pendiente', label: 'Pendiente' };
}

export function whenText(e: CalendarEvent): string {
  const date = capitalize(formatDate(e.event_date));
  if (e.category === 'SESION') {
    if (!e.start_time) return date;
    return `${date} · ${formatTime(e.start_time)}${e.end_time ? ` – ${formatTime(e.end_time)}` : ''}`;
  }
  return `${date} · ${e.start_time ? `hasta ${formatTime(e.start_time)}` : 'sin hora límite'}`;
}

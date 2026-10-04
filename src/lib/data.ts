import type { CalendarEvent } from './types';

const EVENT_COLUMNS = 'event_id, category, type_label, title, event_date, start_time, end_time, link, description';

export { EVENT_COLUMNS };

/** Postgres devuelve '08:00:00'; la app usa '08:00'. */
export function normalizeEvent(row: Record<string, unknown>): CalendarEvent {
  const hhmm = (v: unknown) => (typeof v === 'string' && v ? v.slice(0, 5) : null);
  return {
    event_id: String(row.event_id),
    category: row.category as CalendarEvent['category'],
    type_label: row.type_label as CalendarEvent['type_label'],
    title: String(row.title),
    event_date: String(row.event_date),
    start_time: hhmm(row.start_time),
    end_time: hhmm(row.end_time),
    link: (row.link as string | null) ?? null,
    description: (row.description as string | null) ?? null
  };
}

// Tipado mínimo del cliente para no acoplar este archivo a una versión concreta de supabase-js.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = { from: (table: string) => any };

export async function fetchEvents(client: AnyClient): Promise<CalendarEvent[]> {
  const { data, error } = await client.from('events').select(EVENT_COLUMNS).order('sort_at', { ascending: true }).limit(5000);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map(normalizeEvent);
}

export async function fetchCalendarState(client: AnyClient): Promise<{ version: number; updated_at: string | null }> {
  const { data, error } = await client.from('calendar_state').select('version, updated_at').maybeSingle();
  if (error) throw new Error(error.message);
  return { version: (data?.version as number) ?? 0, updated_at: (data?.updated_at as string) ?? null };
}

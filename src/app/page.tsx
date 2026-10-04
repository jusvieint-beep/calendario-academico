import CalendarApp from '@/components/calendar/CalendarApp';
import Header from '@/components/Header';
import { LockIcon } from '@/components/Icons';
import { fetchCalendarState, fetchEvents } from '@/lib/data';
import { capitalize, formatDate, formatInstant, nowInBogota } from '@/lib/dates';
import { APP_NAME, APP_SUBTITLE } from '@/lib/env';
import { createPublicSupabase } from '@/lib/supabase/server';
import type { CalendarEvent } from '@/lib/types';

// La página se regenera tras cada importación y, como máximo, cada 5 minutos.
export const revalidate = 300;

export default async function HomePage() {
  let events: CalendarEvent[] = [];
  let updatedAt: string | null = null;
  let loadError: string | null = null;

  try {
    const supabase = createPublicSupabase();
    [events, { updated_at: updatedAt }] = await Promise.all([fetchEvents(supabase), fetchCalendarState(supabase)]);
  } catch (e) {
    loadError = (e as Error).message;
  }

  const now = nowInBogota();

  return (
    <main>
      <Header
        appName={APP_NAME}
        subtitle={APP_SUBTITLE}
        right={
          <>
            <div className="today-pill">Hoy: <b>{capitalize(formatDate(now.date))}</b></div>
            <a className="btn btn-ghost admin-link" href="/admin" title="Panel para actualizar el calendario">
              <LockIcon />Administrar
            </a>
          </>
        }
      />
      <CalendarApp events={events} serverNow={now} loadError={loadError} />
      {updatedAt && <p className="foot">Calendario actualizado el {formatInstant(updatedAt)}</p>}
    </main>
  );
}

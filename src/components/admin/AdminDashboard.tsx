'use client';

import { useEffect, useMemo, useState } from 'react';
import type { CalendarEvent, ImportRecord } from '@/lib/types';
import { formatInstant, nowInBogota, type NowCol } from '@/lib/dates';
import { compareEvents, isPast, kindOf, whenText } from '@/lib/events';
import GridEditor from './GridEditor';
import ImportWizard from './ImportWizard';
import HistoryPanel from './HistoryPanel';
import WhatsAppPanel from './WhatsAppPanel';

interface Props {
  adminName: string;
  events: CalendarEvent[];
  imports: ImportRecord[];
  version: number;
  serverNow: NowCol;
}

type Mode = 'grid' | 'excel';

export default function AdminDashboard({ adminName, events, imports, version, serverNow }: Props) {
  const [now, setNow] = useState(serverNow);
  const [mode, setMode] = useState<Mode>('grid');

  useEffect(() => {
    const t = setInterval(() => setNow(nowInBogota()), 60_000);
    return () => clearInterval(t);
  }, []);

  const future = useMemo(() => [...events].sort(compareEvents).filter((e) => !isPast(e, now)), [events, now]);
  const isClass = (e: CalendarEvent) => kindOf(e) === 'SESION_ZAJUNA' || kindOf(e) === 'SESION_ADICIONAL';
  const nextSession = future.find(isClass);
  const futureCount = (k: string) => future.filter((e) => kindOf(e) === k).length;
  const nextDelivery = future.find((e) => e.category === 'ENTREGA');
  const lastApplied = imports.find((i) => i.status === 'applied');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <div className="section-label">Panel administrativo</div>
        <h1 style={{ margin: '4px 0 0', fontSize: 20, fontWeight: 800 }}>Hola, {adminName}</h1>
      </div>

      <div className="kpis">
        <div className="stat">
          <span className="stat-label"><i style={{ background: 'var(--ses)' }} />Sesiones programadas</span>
          <span className="stat-num">{future.filter(isClass).length}</span>
          <span className="stat-sub">Desde hoy · {futureCount('SESION_ZAJUNA')} Zajuna · {futureCount('SESION_ADICIONAL')} adicionales · {futureCount('DUDAS')} de dudas</span>
        </div>
        <div className="stat">
          <span className="stat-label"><i style={{ background: 'var(--ent)' }} />Entregas, cuestionarios y foros</span>
          <span className="stat-num">{future.filter((e) => e.category === 'ENTREGA').length}</span>
          <span className="stat-sub">Sin vencer · {events.filter((e) => e.category === 'ENTREGA').length} en total</span>
        </div>
        <div className="stat">
          <span className="stat-label">Próxima sesión</span>
          <span className="stat-txt">{nextSession?.title ?? '—'}</span>
          <span className="stat-sub">{nextSession ? whenText(nextSession) : 'No hay sesiones próximas'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Próxima fecha límite</span>
          <span className="stat-txt">{nextDelivery?.title ?? '—'}</span>
          <span className="stat-sub">{nextDelivery ? whenText(nextDelivery) : 'No hay fechas límite próximas'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Última actualización</span>
          <span className="stat-txt">{lastApplied ? formatInstant(lastApplied.created_at) : 'Sin actualizaciones'}</span>
          <span className="stat-sub">{lastApplied ? `${lastApplied.admin_email ?? 'Admin'} · ${lastApplied.rows_after ?? 0} eventos` : 'Agrega eventos en la tabla o sube un Excel'}</span>
        </div>
      </div>

      <div className="mode-bar">
        <div className="view-toggle" role="tablist" aria-label="Cómo actualizar el calendario">
          <button type="button" role="tab" aria-selected={mode === 'grid'} className={mode === 'grid' ? 'active' : ''} onClick={() => setMode('grid')}>
            Editar en la plataforma
          </button>
          <button type="button" role="tab" aria-selected={mode === 'excel'} className={mode === 'excel' ? 'active' : ''} onClick={() => setMode('excel')}>
            Subir archivo Excel
          </button>
        </div>
        <span className="stat-sub">Las dos opciones validan, muestran vista previa y guardan un respaldo antes de publicar.</span>
      </div>

      {/* Ambos se mantienen montados: cambiar de pestaña no borra lo que estabas editando. */}
      <div hidden={mode !== 'grid'}>
        <GridEditor events={events} today={now.date} />
      </div>
      <div hidden={mode !== 'excel'}>
        <ImportWizard adminName={adminName} currentCount={events.length} />
      </div>

      <HistoryPanel imports={imports} version={version} />

      <WhatsAppPanel />
    </div>
  );
}

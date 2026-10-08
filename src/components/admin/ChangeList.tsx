'use client';

import { useState } from 'react';
import type { EventFields, SyncResult } from '@/lib/types';
import { formatDate, formatDateShort, formatTime } from '@/lib/dates';
import { kindName } from '@/lib/events';

const FIELD_LABELS: [keyof EventFields, string][] = [
  ['type_label', 'Tipo'],
  ['title', 'Nombre'],
  ['event_date', 'Fecha'],
  ['start_time', 'Hora'],
  ['end_time', 'Hora fin'],
  ['link', 'Enlace'],
  ['description', 'Descripción']
];

function show(field: keyof EventFields, v: string | null): string {
  if (!v) return 'vacío';
  if (field === 'event_date') return formatDateShort(v);
  if (field === 'start_time' || field === 'end_time') return formatTime(v);
  return v;
}

function describeChanges(before: EventFields, after: EventFields): string[] {
  const out: string[] = [];
  for (const [field, label] of FIELD_LABELS) {
    const a = before[field] ?? null, b = after[field] ?? null;
    if (a === b) continue;
    if (field === 'link' || field === 'description') {
      out.push(`${label}: ${!a ? 'agregado' : !b ? 'eliminado' : 'actualizado'}`);
    } else {
      out.push(`${label}: ${show(field, a)} → ${show(field, b)}`);
    }
  }
  return out.length ? out : ['Sin cambios visibles (se normalizará el registro)'];
}

const when = (date: string, time: string | null | undefined) =>
  `${formatDate(date)}${time ? ` · ${formatTime(time)}` : ''}`;

type Tab = 'created' | 'updated' | 'deleted';

export default function ChangeList({ result, initialTab }: { result: SyncResult; initialTab?: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (result.deleted_count ? 'deleted' : result.created_count ? 'created' : 'updated'));

  return (
    <div>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'created'} className={`tab${tab === 'created' ? ' active' : ''}`} onClick={() => setTab('created')}>Se crearán ({result.created_count})</button>
        <button type="button" role="tab" aria-selected={tab === 'updated'} className={`tab${tab === 'updated' ? ' active' : ''}`} onClick={() => setTab('updated')}>Se actualizarán ({result.updated_count})</button>
        <button type="button" role="tab" aria-selected={tab === 'deleted'} className={`tab${tab === 'deleted' ? ' active' : ''}`} onClick={() => setTab('deleted')}>Se eliminarán ({result.deleted_count})</button>
      </div>
      <div className="chg">
        {tab === 'created' && (result.created.length ? result.created.map((e) => (
          <div className="chg-item" key={e.event_id}>
            <span className="chg-id" title={e.auto_id ? 'El ID se asigna automáticamente al confirmar' : undefined}>
              {e.auto_id && e.event_id.startsWith('Nuevo') ? 'ID automático' : e.event_id}
            </span>
            <div><b>{kindName(e)}: {e.title}</b><small>{when(e.event_date, e.start_time)}</small></div>
          </div>
        )) : <div className="empty" style={{ padding: 20 }}>No hay eventos nuevos.</div>)}

        {tab === 'updated' && (result.updated.length ? result.updated.map((u) => (
          <div className="chg-item" key={u.event_id}>
            <span className="chg-id">{u.event_id}</span>
            <div><b>{u.after.title}</b>{describeChanges(u.before, u.after).map((c) => <small key={c}>{c}</small>)}</div>
          </div>
        )) : <div className="empty" style={{ padding: 20 }}>No hay eventos modificados.</div>)}

        {tab === 'deleted' && (result.deleted.length ? result.deleted.map((e) => (
          <div className="chg-item" key={e.event_id}>
            <span className="chg-id">{e.event_id}</span>
            <div><b>{kindName(e)}: {e.title}</b><small>{when(e.event_date, e.start_time)} · ya no aparece en el archivo</small></div>
          </div>
        )) : <div className="empty" style={{ padding: 20 }}>No se eliminará ningún evento.</div>)}
      </div>
    </div>
  );
}

export function Summary({ result, afterLabel = 'Total después', sourceLabel = 'Registros en el archivo' }: { result: SyncResult; afterLabel?: string; sourceLabel?: string }) {
  return (
    <div className="sum">
      <div className="stat"><span className="stat-label">{sourceLabel}</span><span className="stat-num">{result.total}</span><span className="stat-sub">Hoy hay {result.rows_before} en el calendario</span></div>
      <div className="stat"><span className="stat-label"><i style={{ background: 'var(--ses)' }} />Sesiones y dudas</span><span className="stat-num">{result.sessions}</span><span className="stat-sub">{result.recordings ?? 0} {result.recordings === 1 ? 'grabación' : 'grabaciones'}</span></div>
      <div className="stat"><span className="stat-label"><i style={{ background: 'var(--ent)' }} />Entregas, cuestionarios y foros</span><span className="stat-num">{result.deliveries}</span></div>
      <div className="stat"><span className="stat-label">Sin cambios</span><span className="stat-num">{result.unchanged_count}</span></div>
      <div className="stat"><span className="stat-label">Se crearán</span><span className="stat-num c-new">{result.created_count}</span></div>
      <div className="stat"><span className="stat-label">Se actualizarán</span><span className="stat-num c-mod">{result.updated_count}</span></div>
      <div className="stat"><span className="stat-label">Se eliminarán</span><span className="stat-num c-del">{result.deleted_count}</span></div>
      <div className="stat"><span className="stat-label">{afterLabel}</span><span className="stat-num">{result.total}</span></div>
    </div>
  );
}

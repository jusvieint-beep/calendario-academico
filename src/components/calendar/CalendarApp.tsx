'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { CalendarEvent, Kind } from '@/lib/types';
import {
  addDays, addMonths, capitalize, dayName, dayOfMonth, daysInMonth, formatDate, formatTime,
  monthLabel, nowInBogota, weekdayMondayFirst, WEEKDAYS_LONG, WEEKDAYS_SHORT, type NowCol
} from '@/lib/dates';
import { compareEvents, deliveryStatus, isLive, isPast, isPriority, kindName, upcoming, whenText, kindOf, startKey } from '@/lib/events';
import { CategoryIcon } from '../Icons';
import Modal from '../Modal';

type Filter = 'all' | Kind;
type View = 'month' | 'agenda';

interface Props {
  events: CalendarEvent[];
  serverNow: NowCol;
  loadError?: string | null;
}

const MAX_PER_CELL = 3;

export default function CalendarApp({ events, serverNow, loadError }: Props) {
  const router = useRouter();
  const [now, setNow] = useState<NowCol>(serverNow);
  const [nowMs, setNowMs] = useState<number>(() => Date.parse(`${serverNow.date}T${serverNow.time}:00-05:00`));
  const [month, setMonth] = useState(serverNow.date.slice(0, 7));
  const [view, setView] = useState<View>('month');
  const [filter, setFilter] = useState<Filter>('all');
  const [detail, setDetail] = useState<CalendarEvent | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  // Hora real de Colombia: se actualiza cada minuto. Los datos se refrescan cada 5 minutos.
  useEffect(() => {
    const tick = () => { setNow(nowInBogota()); setNowMs(Date.now()); };
    tick();
    const t = setInterval(tick, 60_000);
    const r = setInterval(() => router.refresh(), 5 * 60_000);
    return () => { clearInterval(t); clearInterval(r); };
  }, [router]);

  const sorted = useMemo(() => [...events].sort(compareEvents), [events]);
  const visible = useCallback((e: CalendarEvent) => filter === 'all' || kindOf(e) === filter, [filter]);
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of sorted) {
      if (!visible(e)) continue;
      const list = map.get(e.event_date) ?? [];
      list.push(e);
      map.set(e.event_date, list);
    }
    return map;
  }, [sorted, visible]);

  const inMonth = sorted.filter((e) => e.event_date.startsWith(month));
  const counts: Record<Filter, number> = {
    all: inMonth.length, SESION_ZAJUNA: 0, SESION_ADICIONAL: 0, DUDAS: 0, GRABACION: 0, ENTREGA: 0, CUESTIONARIO: 0, FORO: 0
  };
  for (const e of inMonth) counts[kindOf(e)]++;
  const next5 = useMemo(() => upcoming(sorted, now), [sorted, now]);

  const focusDay = (date: string) => {
    setMonth(date.slice(0, 7));
    setView('month');
    setFlash(date);
    setTimeout(() => setFlash(null), 1800);
  };

  const chip = (e: CalendarEvent, big = false) => (
    <button
      key={e.event_id}
      type="button"
      className={`ev ${kindOf(e)}${isPast(e, now) ? ' past' : ''}`}
      onClick={(ev) => { ev.stopPropagation(); setDay(null); setDetail(e); }}
      title={`${kindName(e)}: ${e.title}`}
      style={big ? { fontSize: 13, padding: '9px 10px', borderRadius: 8 } : undefined}
    >
      <CategoryIcon category={kindOf(e)} />
      {big ? (
        <>
          <span className="t">{e.start_time ? formatTime(e.start_time) : 'Sin hora'}</span>
          <span className="n">{kindName(e)}: {e.title}</span>
        </>
      ) : (
        <>
          {e.start_time && <span className="t">{formatTime(e.start_time).replace(' ', '')}</span>}
          <span className="n">{e.title}</span>
        </>
      )}
    </button>
  );

  const renderMonth = () => {
    const first = `${month}-01`;
    const offset = weekdayMondayFirst(first);
    const rows = Math.ceil((offset + daysInMonth(month)) / 7);
    const start = addDays(first, -offset);
    const cells = Array.from({ length: rows * 7 }, (_, i) => addDays(start, i));
    return (
      <>
        <div className="weekdays" aria-hidden="true">
          {WEEKDAYS_LONG.map((d, i) => (
            <div key={d}><span className="long">{d}</span><span className="short">{WEEKDAYS_SHORT[i]}</span></div>
          ))}
        </div>
        <div className="grid">
          {cells.map((date, i) => {
            const list = byDay.get(date) ?? [];
            const cls = ['cell'];
            if (!date.startsWith(month)) cls.push('out');
            if (i % 7 >= 5) cls.push('weekend');
            if (date === now.date) cls.push('today');
            if (date === flash) cls.push('flash');
            const rest = list.length - MAX_PER_CELL;
            return (
              <div
                key={date}
                className={cls.join(' ')}
                role="button"
                tabIndex={0}
                aria-label={`${capitalize(formatDate(date))}: ${list.length} ${list.length === 1 ? 'actividad' : 'actividades'}`}
                onClick={() => setDay(date)}
                onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); setDay(date); } }}
              >
                <span className="daynum">{dayOfMonth(date)}</span>
                {list.slice(0, MAX_PER_CELL).map((e) => chip(e))}
                {rest > 0 && (
                  <button type="button" className="more" onClick={(ev) => { ev.stopPropagation(); setDay(date); }}>+{rest} más</button>
                )}
                <div className="dots" aria-hidden="true">
                  {list.slice(0, 4).map((e) => <i key={e.event_id} className={kindOf(e)} />)}
                </div>
              </div>
            );
          })}
        </div>
        {!inMonth.some(visible) && <div className="empty"><b>No hay actividades este mes</b>Usa las flechas para ver otros meses.</div>}
      </>
    );
  };

  const renderAgenda = () => {
    const list = inMonth.filter(visible);
    if (!list.length) return <div className="empty"><b>No hay actividades este mes</b>Usa las flechas para ver otros meses.</div>;
    const days = [...new Set(list.map((e) => e.event_date))];
    return (
      <div className="agenda">
        {days.map((d) => (
          <div className="ag-day" key={d}>
            <div className={`ag-date${d === now.date ? ' today' : ''}`}><b>{dayOfMonth(d)}</b>{dayName(d)}</div>
            <div className="ag-list">{list.filter((e) => e.event_date === d).map((e) => chip(e, true))}</div>
          </div>
        ))}
      </div>
    );
  };

  const statusBadge = (e: CalendarEvent) => {
    if (e.category === 'GRABACION') {
      return startKey(e) <= `${now.date}T${now.time}`
        ? <span className="badge b-live">Disponible</span>
        : <span className="badge b-ok">Disponible desde el {formatDate(e.event_date, false)}</span>;
    }
    if (e.category === 'SESION') {
      if (isLive(e, now)) return <span className="badge b-live">En curso</span>;
      if (isPast(e, now)) return <span className="badge b-ok">Finalizada</span>;
      return null;
    }
    const s = deliveryStatus(e, now, nowMs);
    const cls = s.status === 'vencido' ? 'b-late' : s.status === 'pronto' ? 'b-soon' : 'b-ok';
    return <span className={`badge ${cls}`}>{s.label}</span>;
  };

  /** Botón del enlace: sesiones → «Ingresar a la sesión», dudas → «Ir al chat de dudas», grabación → «Ver grabación», foro → «Ir al foro», cuestionario → «Presentar cuestionario». */
  const JOIN: Partial<Record<Kind, { cls: string; label: string }>> = {
    SESION_ZAJUNA: { cls: 'btn-ses', label: 'Ingresar a la sesión' },
    SESION_ADICIONAL: { cls: 'btn-adi', label: 'Ingresar a la sesión' },
    DUDAS: { cls: 'btn-dud', label: 'Ir al chat de dudas' },
    GRABACION: { cls: 'btn-rec', label: 'Ver grabación' },
    FORO: { cls: 'btn-foro', label: 'Ir al foro' },
    CUESTIONARIO: { cls: 'btn-quiz', label: 'Presentar cuestionario' }
  };
  const hasJoin = (e: CalendarEvent) => Boolean(JOIN[kindOf(e)]);
  const joinButton = (e: CalendarEvent, small = false) => {
    const k = kindOf(e);
    const j = JOIN[k];
    if (!e.link || !j) return null;
    return (
      <a className={`btn ${j.cls}${small ? ' btn-sm' : ''}`} href={e.link} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()}>
        {!small && <CategoryIcon category={k} />}{j.label}
      </a>
    );
  };

  const filters: [Filter, string, string, string][] = [
    ['all', 'Todas', 'var(--accent)', 'var(--accent-soft)'],
    ['SESION_ZAJUNA', 'Sesiones Zajuna', 'var(--ses)', 'var(--ses-soft)'],
    ['SESION_ADICIONAL', 'Sesiones adicionales', 'var(--adi)', 'var(--adi-soft)'],
    ['DUDAS', 'Dudas', 'var(--dud)', 'var(--dud-soft)'],
    ['GRABACION', 'Grabaciones', 'var(--rec)', 'var(--rec-soft)'],
    ['ENTREGA', 'Entregas', 'var(--ent)', 'var(--ent-soft)'],
    ['CUESTIONARIO', 'Cuestionarios', 'var(--quiz)', 'var(--quiz-soft)'],
    ['FORO', 'Foros', 'var(--foro)', 'var(--foro-soft)']
  ];

  return (
    <>
      {loadError && (
        <div className="alert a-err" role="alert">
          <b>No se pudo cargar el calendario.</b> Revisa tu conexión y recarga la página. Si el problema continúa, avisa al administrador.
        </div>
      )}
      <div className="layout">
        <section className="panel" aria-label="Calendario">
          <div className="cal-toolbar">
            <div className="nav">
              <button className="icon-btn" type="button" aria-label="Mes anterior" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
              <button className="icon-btn" type="button" aria-label="Mes siguiente" onClick={() => setMonth(addMonths(month, 1))}>›</button>
            </div>
            <h1 className="cal-title" aria-live="polite">{monthLabel(month)}</h1>
            <button className="btn btn-sm" type="button" onClick={() => focusDay(now.date)}>Hoy</button>
            <div className="view-toggle">
              <button type="button" className={view === 'month' ? 'active' : ''} onClick={() => setView('month')}>Mes</button>
              <button type="button" className={view === 'agenda' ? 'active' : ''} onClick={() => setView('agenda')}>Agenda</button>
            </div>
            <div className="chips">
              {filters.map(([k, label, c, bg]) => (
                <button
                  key={k}
                  type="button"
                  className={`chip${filter === k ? ' active' : ''}`}
                  style={{ ['--chip-c' as string]: c, ['--chip-bg' as string]: bg }}
                  onClick={() => setFilter(k)}
                  aria-pressed={filter === k}
                >
                  {k !== 'all' && <span className="dot" style={{ background: c }} />}
                  {label} <span className="count num">{counts[k]}</span>
                </button>
              ))}
            </div>
          </div>
          {view === 'month' ? renderMonth() : renderAgenda()}
        </section>

        <aside className="panel side" aria-labelledby="up-title">
          <div className="side-head"><h2 id="up-title">Próximas actividades</h2><span>Las 5 más cercanas</span></div>
          <div className="up-list">
            {next5.length ? next5.map((e) => {
              const badge = e.category === 'ENTREGA' || isLive(e, now) ? statusBadge(e) : null;
              const prio = isPriority(e) ? <span className="badge b-prio">Prioritaria</span> : null;
              const join = hasJoin(e) ? joinButton(e, true) : null;
              return (
                <div
                  key={e.event_id}
                  className={`up ${kindOf(e)}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => { focusDay(e.event_date); setDetail(e); }}
                  onKeyDown={(k) => { if (k.key === 'Enter') { focusDay(e.event_date); setDetail(e); } }}
                >
                  <div className="up-ico"><CategoryIcon category={kindOf(e)} /></div>
                  <div className="up-body">
                    <span className="up-kind">{kindName(e)}</span>
                    <span className="up-title">{e.title}</span>
                    <span className="up-when">{whenText(e)}</span>
                    {(prio || badge || join) && <div className="up-row">{prio}{badge}{join}</div>}
                  </div>
                </div>
              );
            }) : (
              <div className="empty"><b>No hay actividades próximas</b>Cuando se publiquen nuevas sesiones, espacios de dudas o entregas aparecerán aquí.</div>
            )}
          </div>
          <div className="legend">
            <span><i style={{ background: 'var(--ses)' }} />Sesión Zajuna</span>
            <span><i style={{ background: 'var(--adi)' }} />Sesión adicional</span>
            <span><i style={{ background: 'var(--dud)' }} />Dudas</span>
            <span><i style={{ background: 'var(--rec)' }} />Grabación</span>
            <span><i style={{ background: 'var(--ent)' }} />Entrega</span>
            <span><i style={{ background: 'var(--quiz)' }} />Cuestionario</span>
            <span><i style={{ background: 'var(--foro)' }} />Foro</span>
          </div>
        </aside>
      </div>

      {day && (
        <Modal onClose={() => setDay(null)} labelledBy="day-title">
          <div className="modal-head">
            <div>
              <span className="up-kind" style={{ color: 'var(--text-faint)' }}>
                {(byDay.get(day) ?? []).length} {(byDay.get(day) ?? []).length === 1 ? 'actividad' : 'actividades'}
              </span>
              <h3 id="day-title">{capitalize(formatDate(day))}</h3>
            </div>
            <button className="icon-btn x" type="button" aria-label="Cerrar" onClick={() => setDay(null)}>✕</button>
          </div>
          {(byDay.get(day) ?? []).length ? (
            <div className="ag-list">{(byDay.get(day) ?? []).map((e) => chip(e, true))}</div>
          ) : (
            <div className="empty" style={{ padding: 20 }}><b>Sin actividades</b>Este día no tiene sesiones, grabaciones ni entregas.</div>
          )}
        </Modal>
      )}

      {detail && (
        <Modal onClose={() => setDetail(null)} labelledBy="detail-title">
          <div className={`modal-head ${kindOf(detail)}`}>
            <div className="up-ico"><CategoryIcon category={kindOf(detail)} /></div>
            <div>
              <span className="up-kind">{kindName(detail)} · <span className="num" style={{ color: 'var(--text-faint)' }}>{detail.event_id}</span></span>
              <h3 id="detail-title">{detail.title}</h3>
            </div>
            <button className="icon-btn x" type="button" aria-label="Cerrar" onClick={() => setDetail(null)}>✕</button>
          </div>
          {detail.category === 'GRABACION' ? (
            <dl className="kv">
              <dt>Disponible desde</dt><dd>{capitalize(formatDate(detail.event_date, true, true))}{detail.start_time ? ` · ${formatTime(detail.start_time)}` : ''}</dd>
              <dt>Tipo</dt><dd>{kindName(detail)}</dd>
              <dt>Estado</dt><dd>{statusBadge(detail)}</dd>
              {detail.description && (<><dt>Descripción</dt><dd>{detail.description}</dd></>)}
            </dl>
          ) : detail.category === 'SESION' ? (
            <>
              {(isPriority(detail) || isLive(detail, now)) && (
                <div className="up-row">
                  {isPriority(detail) && <span className="badge b-prio">Prioritaria</span>}
                  {isLive(detail, now) && <span className="badge b-live">En curso</span>}
                </div>
              )}
              <dl className="kv">
                <dt>Fecha</dt><dd>{capitalize(formatDate(detail.event_date, true, true))}</dd>
                <dt>Hora</dt><dd className="num">{formatTime(detail.start_time)}{detail.end_time ? ` – ${formatTime(detail.end_time)}` : ''}</dd>
                <dt>Tipo</dt><dd>{kindName(detail)}</dd>
                {detail.description && (<><dt>Descripción</dt><dd>{detail.description}</dd></>)}
                <dt>{kindOf(detail) === 'DUDAS' ? 'Chat' : 'Enlace'}</dt><dd>{detail.link ?? <span style={{ color: 'var(--text-faint)' }}>{kindOf(detail) === 'DUDAS' ? 'El enlace al chat se publicará cuando esté disponible' : 'Aún no tiene enlace'}</span>}</dd>
              </dl>
            </>
          ) : (
            <dl className="kv">
              <dt>{kindOf(detail) === 'ENTREGA' ? 'Fecha de entrega' : 'Fecha límite'}</dt><dd>{capitalize(formatDate(detail.event_date, true, true))}</dd>
              <dt>Hora límite</dt><dd className="num">{detail.start_time ? formatTime(detail.start_time) : 'Sin hora límite (vence al final del día)'}</dd>
              <dt>Tipo</dt><dd>{kindName(detail)}</dd>
              <dt>Estado</dt><dd>{statusBadge(detail)}</dd>
              {detail.description && (<><dt>Descripción</dt><dd>{detail.description}</dd></>)}
              {detail.link && !hasJoin(detail) && (<><dt>Enlace</dt><dd><a href={detail.link} target="_blank" rel="noopener noreferrer">{detail.link}</a></dd></>)}
            </dl>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setDetail(null)}>Cerrar</button>
            {detail.category === 'SESION' && (joinButton(detail) ?? <button className="btn" type="button" disabled>{kindOf(detail) === 'DUDAS' ? 'Chat aún sin enlace' : 'Sin enlace disponible'}</button>)}
            {detail.category === 'GRABACION' && (joinButton(detail) ?? <button className="btn" type="button" disabled>Grabación aún no disponible</button>)}
            {detail.category === 'ENTREGA' && joinButton(detail)}
          </div>
        </Modal>
      )}
    </>
  );
}

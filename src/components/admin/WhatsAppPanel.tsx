'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateShort, formatInstant } from '@/lib/dates';
import { ErrorIcon, OkIcon } from '../Icons';

interface LogRow {
  id: number;
  kind: 'digest' | 'test';
  target_date: string | null;
  status: 'sent' | 'skipped' | 'error';
  http_status: number | null;
  detail: string | null;
  created_at: string;
}

interface NotifyStatus {
  enabled: boolean;
  phone: string | null;
  send_hour: number;
  has_key: boolean;
  preview: string | null;
  log: LogRow[];
}

const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

/** *texto* de WhatsApp → negrita, igual que se ve en el celular. */
function WaText({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, i) => (
        <div key={i}>
          {line ? line.split(/(\*[^*]+\*)/g).map((part, j) => (part.startsWith('*') && part.endsWith('*') && part.length > 2 ? <b key={j}>{part.slice(1, -1)}</b> : part)) : ' '}
        </div>
      ))}
    </>
  );
}

const STATUS_PILL: Record<LogRow['status'], [string, string, string]> = {
  sent: ['Enviado', 'var(--green-soft)', 'var(--green)'],
  skipped: ['Omitido', 'var(--surface-2)', 'var(--text-dim)'],
  error: ['Error', 'var(--red-soft)', 'var(--red)']
};

export default function WhatsAppPanel() {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hour, setHour] = useState(20);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<'save' | 'test' | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const apply = (s: NotifyStatus) => {
    setStatus(s);
    setPhone(s.phone ?? '');
    setHour(s.send_hour);
    setEnabled(s.enabled);
    if (!s.has_key) setShowHelp(true);
  };

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/notify', { cache: 'no-store' });
      const json = await res.json();
      if (json.ok) { apply(json.status); setLoadError(null); }
      else setLoadError(json.message);
    } catch {
      setLoadError('No hay conexión con el servidor.');
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (opts?: { enable?: boolean }) => {
    setBusy('save'); setMessage(null);
    const nextEnabled = opts?.enable ?? enabled;
    try {
      const res = await fetch('/api/notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', enabled: nextEnabled, phone, sendHour: hour, apiKey })
      });
      const json = await res.json();
      if (json.ok) {
        apply(json.status);
        setApiKey('');
        setMessage({
          ok: true,
          text: json.status.enabled && json.status.has_key
            ? `Guardado. Recibirás el resumen de mañana todos los días a las ${hourLabel(json.status.send_hour)} (si hay actividades).`
            : json.status.has_key ? 'Guardado. El recordatorio está desactivado.' : 'Guardado. Falta la clave de CallMeBot para poder enviar.'
        });
      } else {
        setMessage({ ok: false, text: json.message });
      }
    } catch {
      setMessage({ ok: false, text: 'No hay conexión con el servidor.' });
    }
    setBusy(null);
  };

  const test = async () => {
    setBusy('test'); setMessage(null);
    try {
      const res = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
      const json = await res.json();
      if (json.ok && json.result.ok) {
        setMessage({ ok: true, text: 'Prueba enviada. Debe llegarte a WhatsApp en unos segundos.' });
      } else {
        const detail = json.ok ? json.result.detail : json.message;
        setMessage({ ok: false, text: `No se pudo enviar la prueba. ${detail ?? ''}`.trim() });
      }
      await load();
    } catch {
      setMessage({ ok: false, text: 'No hay conexión con el servidor.' });
    }
    setBusy(null);
  };

  const pill = !status ? null
    : status.enabled && status.has_key ? <span className="pill" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>Activo · {hourLabel(status.send_hour)}</span>
    : !status.has_key ? <span className="pill" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>Falta la clave</span>
    : <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}>Desactivado</span>;

  return (
    <section className="box" aria-labelledby="wa-title">
      <div className="box-head">
        <div className="wa-title"><h2 id="wa-title">Recordatorio por WhatsApp</h2>{pill}</div>
        <span className="stat-sub">Solo para ti · resumen de las actividades de mañana · gratis con CallMeBot</span>
      </div>

      {loadError && <div className="alert a-err" role="alert"><ErrorIcon /><div>{loadError}</div></div>}
      {message && (
        <div className={`alert ${message.ok ? 'a-ok' : 'a-err'}`} role="status">{message.ok ? <OkIcon /> : <ErrorIcon />}<div>{message.text}</div></div>
      )}

      {status && (
        <div className="wa-grid">
          <form
            className="wa-form"
            onSubmit={(e) => { e.preventDefault(); save(); }}
          >
            <div className="field">
              <label htmlFor="wa-phone">Tu número de WhatsApp</label>
              <input id="wa-phone" inputMode="tel" autoComplete="tel" placeholder="+57 322 484 2807" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="wa-key">Clave de CallMeBot (apikey)</label>
              <input
                id="wa-key"
                type="password"
                autoComplete="off"
                placeholder={status.has_key ? 'Guardada ✓ · escribe otra solo para cambiarla' : 'El número que te envió CallMeBot'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <button type="button" className="link-btn" onClick={() => setShowHelp((v) => !v)}>
                {showHelp ? 'Ocultar instrucciones' : '¿Cómo obtengo la clave?'}
              </button>
              {showHelp && (
                <ol className="wa-help">
                  <li>Guarda en tus contactos el número <b>+34 623 91 22 04</b>.</li>
                  <li>Envíale por WhatsApp exactamente: <code>I allow callmebot to send me messages</code></li>
                  <li>Te responderá con tu <b>apikey</b>. Cópiala aquí y pulsa <b>Guardar</b>.</li>
                  <li>Si no responde en 2 minutos, vuelve a intentarlo en 24 horas.</li>
                </ol>
              )}
            </div>
            <div className="field">
              <label htmlFor="wa-hour">Hora del resumen (hora de Colombia)</label>
              <select id="wa-hour" className="wa-select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}{h === 20 ? ' (recomendada)' : ''}</option>)}
              </select>
            </div>
            <label className="wa-check">
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
              <span>Enviarme el resumen todos los días</span>
            </label>
            <div className="wa-actions">
              <button className="btn btn-primary" type="submit" disabled={busy !== null}>{busy === 'save' ? 'Guardando…' : 'Guardar'}</button>
              <button className="btn" type="button" onClick={test} disabled={busy !== null || !status.has_key} title={status.has_key ? 'Envía ahora un mensaje de prueba a tu WhatsApp' : 'Primero guarda la clave de CallMeBot'}>
                {busy === 'test' ? 'Enviando…' : 'Enviar prueba'}
              </button>
            </div>
            <p className="stat-sub">Si mañana no hay sesiones ni fechas límite, ese día no se envía nada. Nunca se envía dos veces el mismo día.</p>
          </form>

          <div className="wa-side">
            <div className="section-label">Así llegará el resumen de mañana</div>
            <div className="wa-bubble">
              {status.preview ? <WaText text={status.preview} /> : <span className="stat-sub">Mañana no hay sesiones ni fechas límite: hoy no se enviará mensaje.</span>}
            </div>

            <div className="section-label" style={{ marginTop: 14 }}>Últimos envíos</div>
            {status.log.length === 0 ? (
              <div className="stat-sub">Aún no hay envíos.</div>
            ) : (
              <ul className="wa-log">
                {status.log.map((l) => {
                  const [label, bg, fg] = STATUS_PILL[l.status];
                  return (
                    <li key={l.id}>
                      <span className="pill" style={{ background: bg, color: fg }}>{label}</span>
                      <div>
                        <b>{l.kind === 'test' ? 'Prueba' : `Resumen del ${l.target_date ? formatDateShort(l.target_date) : '—'}`}</b>
                        <span className="stat-sub">{formatInstant(l.created_at)}{l.status === 'error' && l.detail ? ` · ${l.detail}` : ''}</span>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

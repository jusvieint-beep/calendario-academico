'use client';

import { useCallback, useEffect, useState } from 'react';
import { formatDateShort, formatInstant } from '@/lib/dates';
import { ErrorIcon, OkIcon } from '../Icons';

interface LogRow {
  id: number;
  kind: 'digest' | 'test' | 'reminder';
  target_date: string | null;
  status: 'sent' | 'skipped' | 'error';
  http_status: number | null;
  detail: string | null;
  created_at: string;
  /** Nombre del destinatario (o el número si ya no está en la lista). */
  recipient: string | null;
}

interface Recipient {
  id: number;
  label: string;
  phone: string;
  enabled: boolean;
  has_key: boolean;
}

interface NotifyStatus {
  enabled: boolean;
  send_hour: number;
  remind_minutes: number | null;
  recipients: Recipient[];
  preview: string | null;
  log: LogRow[];
}

interface RecipientForm {
  id: number | null;
  label: string;
  phone: string;
  apiKey: string;
  enabled: boolean;
}

const REMIND_OPTIONS: [number | null, string][] = [[null, 'Sin recordatorio'], [30, '30 minutos antes'], [60, '1 hora antes'], [120, '2 horas antes (recomendado)'], [180, '3 horas antes'], [360, '6 horas antes']];
const remindLabel = (m: number | null) => (m === null ? 'sin recordatorio' : m % 60 === 0 ? `${m / 60} h antes` : `${m} min antes`);
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
/** +573224842807 → +57 322 484 2807 (solo para mostrar). */
const prettyPhone = (p: string) => (p.startsWith('+57') && p.length === 13 ? `+57 ${p.slice(3, 6)} ${p.slice(6, 9)} ${p.slice(9)}` : p);

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

function KeyHelp() {
  return (
    <ol className="wa-help">
      <li>Desde el celular del número a agregar, guarda en contactos el bot de CallMeBot: <b>+34 644 97 54 14</b> (el anterior, +34 623 91 22 04, está lleno).</li>
      <li>Envíale por WhatsApp exactamente la frase que indique el bot, por ejemplo: <code>I allow callmebot to send me messages</code></li>
      <li>Responderá con la <b>apikey</b> de ese número. Cada número tiene su propia clave.</li>
      <li>Si el bot responde que está lleno, guarda el nuevo número que indique y repite el paso 2 con ese.</li>
    </ol>
  );
}

const STATUS_PILL: Record<LogRow['status'], [string, string, string]> = {
  sent: ['Enviado', 'var(--green-soft)', 'var(--green)'],
  skipped: ['Omitido', 'var(--surface-2)', 'var(--text-dim)'],
  error: ['Error', 'var(--red-soft)', 'var(--red)']
};

const EMPTY_FORM: RecipientForm = { id: null, label: '', phone: '+57 ', apiKey: '', enabled: true };

export default function WhatsAppPanel() {
  const [status, setStatus] = useState<NotifyStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hour, setHour] = useState(20);
  const [remind, setRemind] = useState<number | null>(120);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [form, setForm] = useState<RecipientForm | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);

  const apply = (s: NotifyStatus) => {
    setStatus(s);
    setHour(s.send_hour);
    setRemind(s.remind_minutes);
    setEnabled(s.enabled);
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

  const post = async (key: string, body: Record<string, unknown>) => {
    setBusy(key); setMessage(null);
    try {
      const res = await fetch('/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const json = await res.json();
      setBusy(null);
      if (!json.ok) { setMessage({ ok: false, text: json.message }); return null; }
      return json;
    } catch {
      setBusy(null);
      setMessage({ ok: false, text: 'No hay conexión con el servidor.' });
      return null;
    }
  };

  const saveGeneral = async () => {
    const json = await post('general', { action: 'general', enabled, sendHour: hour, remindMinutes: remind });
    if (!json) return;
    apply(json.status);
    const s: NotifyStatus = json.status;
    const active = s.recipients.filter((r) => r.enabled && r.has_key).length;
    setMessage({
      ok: true,
      text: s.enabled
        ? `Guardado. Resumen de mañana a las ${hourLabel(s.send_hour)}${s.remind_minutes ? ` y aviso ${remindLabel(s.remind_minutes)} de cada sesión` : ''}, a ${active} ${active === 1 ? 'número' : 'números'}.`
        : 'Guardado. Los recordatorios están desactivados.'
    });
  };

  const saveRecipient = async () => {
    if (!form) return;
    const json = await post('recipient', { action: 'recipient', id: form.id, label: form.label, phone: form.phone, apiKey: form.apiKey, enabled: form.enabled });
    if (!json) return;
    apply(json.status);
    setMessage({ ok: true, text: form.id ? `«${form.label}» actualizado.` : `«${form.label}» agregado. Usa «Probar» para confirmar que le llegan los mensajes.` });
    setForm(null);
  };

  const toggleRecipient = async (r: Recipient) => {
    const json = await post(`toggle-${r.id}`, { action: 'recipient', id: r.id, label: r.label, phone: r.phone, enabled: !r.enabled });
    if (json) { apply(json.status); setMessage({ ok: true, text: `«${r.label}» ${r.enabled ? 'pausado: no recibirá mensajes' : 'activado'}.` }); }
  };

  const removeRecipient = async (r: Recipient) => {
    const json = await post(`remove-${r.id}`, { action: 'archive', id: r.id });
    setConfirmRemove(null);
    if (json) { apply(json.status); setMessage({ ok: true, text: `«${r.label}» quitado de la lista. Su historial de envíos se conserva.` }); }
  };

  const test = async (id: number | null) => {
    const json = await post(`test-${id ?? 'all'}`, { action: 'test', id });
    await load();
    if (!json) return;
    const results = json.results as { label: string; ok: boolean; detail: string | null }[];
    if (!results.length) { setMessage({ ok: false, text: 'No hay números activos con clave para enviar la prueba.' }); return; }
    const failed = results.filter((r) => !r.ok);
    setMessage(failed.length
      ? { ok: false, text: `No se pudo enviar a: ${failed.map((r) => `${r.label} (${r.detail ?? 'error'})`).join('; ')}.${results.length > failed.length ? ' A los demás sí se envió.' : ''}` }
      : { ok: true, text: `Prueba enviada a ${results.map((r) => r.label).join(', ')}. Debe llegar a WhatsApp en unos segundos.` });
  };

  const activeCount = status ? status.recipients.filter((r) => r.enabled && r.has_key).length : 0;
  const pill = !status ? null
    : status.enabled && activeCount ? <span className="pill" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>Activo · {activeCount} {activeCount === 1 ? 'número' : 'números'} · {hourLabel(status.send_hour)}{status.remind_minutes ? ` · ${remindLabel(status.remind_minutes)}` : ''}</span>
    : !activeCount ? <span className="pill" style={{ background: 'var(--warn-soft)', color: 'var(--warn)' }}>Sin números activos</span>
    : <span className="pill" style={{ background: 'var(--surface-2)', color: 'var(--text-dim)' }}>Desactivado</span>;

  return (
    <section className="box" aria-labelledby="wa-title">
      <div className="box-head">
        <div className="wa-title"><h2 id="wa-title">Recordatorio por WhatsApp</h2>{pill}</div>
        <span className="stat-sub">Resumen diario y aviso antes de cada sesión · gratis con CallMeBot (uso personal)</span>
      </div>

      {loadError && <div className="alert a-err" role="alert"><ErrorIcon /><div>{loadError}</div></div>}
      {message && (
        <div className={`alert ${message.ok ? 'a-ok' : 'a-err'}`} role="status">{message.ok ? <OkIcon /> : <ErrorIcon />}<div>{message.text}</div></div>
      )}

      {status && (
        <div className="wa-grid">
          <div className="wa-form">
            {/* ---------------------------------------------- Destinatarios */}
            <div className="section-label">Números que reciben los mensajes</div>
            <ul className="wa-recipients">
              {status.recipients.map((r) => (
                <li key={r.id} className={r.enabled ? '' : 'off'}>
                  <div className="wa-rec-main">
                    <b>{r.label}</b>
                    <span className="stat-sub">
                      {prettyPhone(r.phone)} · {r.has_key ? 'clave guardada ✓' : 'sin clave'} · {r.enabled ? 'activo' : 'pausado'}
                    </span>
                  </div>
                  {confirmRemove === r.id ? (
                    <div className="wa-rec-actions">
                      <span className="stat-sub">¿Quitar este número?</span>
                      <button className="btn btn-sm btn-danger" type="button" disabled={busy !== null} onClick={() => removeRecipient(r)}>Sí, quitar</button>
                      <button className="btn btn-sm" type="button" onClick={() => setConfirmRemove(null)}>Cancelar</button>
                    </div>
                  ) : (
                    <div className="wa-rec-actions">
                      <button className="btn btn-sm" type="button" disabled={busy !== null || !r.has_key} onClick={() => test(r.id)} title="Enviar una prueba solo a este número">
                        {busy === `test-${r.id}` ? 'Enviando…' : 'Probar'}
                      </button>
                      <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={() => toggleRecipient(r)}>{r.enabled ? 'Pausar' : 'Activar'}</button>
                      <button className="btn btn-sm" type="button" disabled={busy !== null} onClick={() => { setMessage(null); setForm({ id: r.id, label: r.label, phone: prettyPhone(r.phone), apiKey: '', enabled: r.enabled }); }}>Editar</button>
                      <button className="btn btn-sm btn-ghost" type="button" disabled={busy !== null} onClick={() => setConfirmRemove(r.id)}>Quitar</button>
                    </div>
                  )}
                </li>
              ))}
              {status.recipients.length === 0 && <li className="stat-sub">Aún no hay números. Agrega el primero.</li>}
            </ul>

            {form ? (
              <form className="wa-rec-form" onSubmit={(e) => { e.preventDefault(); saveRecipient(); }}>
                <div className="section-label">{form.id ? 'Editar número' : 'Agregar otro número'}</div>
                <div className="wa-rec-fields">
                  <div className="field">
                    <label htmlFor="wa-r-label">Nombre</label>
                    <input id="wa-r-label" maxLength={40} placeholder="Ej.: Mi otro celular" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
                  </div>
                  <div className="field">
                    <label htmlFor="wa-r-phone">Número de WhatsApp</label>
                    <input id="wa-r-phone" inputMode="tel" autoComplete="off" placeholder="+57 300 123 4567" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                  </div>
                </div>
                <div className="field">
                  <label htmlFor="wa-r-key">Clave de CallMeBot (apikey) de este número</label>
                  <input
                    id="wa-r-key"
                    type="password"
                    autoComplete="off"
                    placeholder={form.id ? 'Guardada ✓ · escribe otra solo para cambiarla' : 'La clave que CallMeBot le envió a este número'}
                    value={form.apiKey}
                    onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  />
                </div>
                {!form.id && <KeyHelp />}
                <div className="wa-actions">
                  <button className="btn btn-primary" type="submit" disabled={busy !== null}>{busy === 'recipient' ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Agregar número'}</button>
                  <button className="btn" type="button" onClick={() => setForm(null)}>Cancelar</button>
                </div>
              </form>
            ) : (
              <button className="btn wa-add" type="button" onClick={() => { setMessage(null); setForm({ ...EMPTY_FORM }); }}>+ Agregar otro número</button>
            )}

            {/* ---------------------------------------------- Ajustes generales */}
            <form className="wa-general" onSubmit={(e) => { e.preventDefault(); saveGeneral(); }}>
              <div className="section-label">Qué y cuándo se envía (aplica a todos los números)</div>
              <div className="field">
                <label htmlFor="wa-hour">Hora del resumen de mañana (hora de Colombia)</label>
                <select id="wa-hour" className="wa-select" value={hour} onChange={(e) => setHour(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}{h === 20 ? ' (recomendada)' : ''}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="wa-remind">Aviso antes de cada sesión (Zajuna, adicional y dudas)</label>
                <select id="wa-remind" className="wa-select" value={remind ?? ''} onChange={(e) => setRemind(e.target.value === '' ? null : Number(e.target.value))}>
                  {REMIND_OPTIONS.map(([v, l]) => <option key={l} value={v ?? ''}>{l}</option>)}
                </select>
              </div>
              <label className="wa-check">
                <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
                <span>Activar recordatorios por WhatsApp</span>
              </label>
              <div className="wa-actions">
                <button className="btn btn-primary" type="submit" disabled={busy !== null}>{busy === 'general' ? 'Guardando…' : 'Guardar'}</button>
                <button className="btn" type="button" onClick={() => test(null)} disabled={busy !== null || !activeCount} title="Envía una prueba a todos los números activos">
                  {busy === 'test-all' ? 'Enviando…' : 'Enviar prueba a todos'}
                </button>
              </div>
              <p className="stat-sub">Si mañana no hay sesiones ni fechas límite, ese día no se envía nada. Cada número recibe cada mensaje una sola vez; si uno falla, los demás reciben igual.</p>
            </form>
          </div>

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
                        <b>
                          {l.kind === 'test' ? 'Prueba' : l.kind === 'reminder' ? `Aviso de sesión · ${l.target_date ? formatDateShort(l.target_date) : ''}` : `Resumen del ${l.target_date ? formatDateShort(l.target_date) : '—'}`}
                          {l.recipient && <span className="wa-log-to"> → {l.recipient.startsWith('+') ? prettyPhone(l.recipient) : l.recipient}</span>}
                        </b>
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

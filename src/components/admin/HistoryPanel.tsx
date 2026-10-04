'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ImportRecord, SyncResult } from '@/lib/types';
import { formatInstant } from '@/lib/dates';
import { ErrorIcon } from '../Icons';
import Modal from '../Modal';
import ChangeList from './ChangeList';

interface Props {
  imports: ImportRecord[];
  version: number;
}

export default function HistoryPanel({ imports }: Props) {
  const router = useRouter();
  const [target, setTarget] = useState<ImportRecord | null>(null);
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const call = async (importId: string, dryRun: boolean, expectedVersion?: number) => {
    const res = await fetch('/api/import/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ importId, dryRun, expectedVersion })
    });
    return res.json();
  };

  const open = async (rec: ImportRecord) => {
    setTarget(rec); setPreview(null); setMessage(null); setBusy(true);
    try {
      const json = await call(rec.id, true);
      if (json.ok) setPreview(json.result);
      else setMessage({ ok: false, text: json.message });
    } catch {
      setMessage({ ok: false, text: 'No hay conexión con el servidor.' });
    }
    setBusy(false);
  };

  const confirm = async () => {
    if (!target || !preview) return;
    setBusy(true);
    try {
      const json = await call(target.id, false, preview.version);
      if (json.ok) {
        setTarget(null);
        setMessage({ ok: true, text: `Calendario restaurado: ${json.result.total} eventos. El cambio quedó registrado en el historial.` });
        router.refresh();
      } else {
        setMessage({ ok: false, text: json.message });
      }
    } catch {
      setMessage({ ok: false, text: 'Se perdió la conexión. Recarga la página y revisa el historial.' });
    }
    setBusy(false);
  };

  const statusPill = (r: ImportRecord) =>
    r.status === 'failed'
      ? <span className="pill" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Fallida · sin cambios</span>
      : <span className="pill" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>{r.kind === 'restore' ? 'Restauración' : 'Aplicada'}</span>;

  return (
    <section className="box" aria-labelledby="history-title">
      <div className="box-head">
        <h2 id="history-title">Historial de importaciones</h2>
        <span className="stat-sub">Se conservan los respaldos de las últimas 30 actualizaciones</span>
      </div>

      {message && !target && (
        <div className={`alert ${message.ok ? 'a-ok' : 'a-err'}`} role="status">{!message.ok && <ErrorIcon />}<div>{message.text}</div></div>
      )}

      {imports.length === 0 ? (
        <div className="empty"><b>Aún no hay importaciones</b>Cuando cargues el primer Excel aparecerá aquí.</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Fecha</th><th>Archivo</th><th>Realizada por</th><th>Creados</th><th>Actualizados</th><th>Eliminados</th><th>Total</th><th>Estado</th><th /></tr>
            </thead>
            <tbody>
              {imports.map((r) => (
                <tr key={r.id}>
                  <td className="num" style={{ whiteSpace: 'nowrap' }}>{formatInstant(r.created_at)}</td>
                  <td>{r.kind === 'restore' ? 'Restauración de respaldo' : r.file_name ?? '—'}{r.error_message && <div className="stat-sub">{r.error_message.slice(0, 80)}</div>}</td>
                  <td>{r.admin_email ?? '—'}</td>
                  <td className="num">{r.created_count}</td>
                  <td className="num">{r.updated_count}</td>
                  <td className="num">{r.deleted_count}</td>
                  <td className="num">{r.status === 'applied' ? r.rows_after : '—'}</td>
                  <td>{statusPill(r)}</td>
                  <td>
                    {r.status === 'applied' && r.has_snapshot && (r.rows_before ?? 0) > 0 && (
                      <button className="btn btn-sm" type="button" onClick={() => open(r)} title="Volver al calendario como estaba justo antes de esta actualización">
                        Deshacer
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {target && (
        <Modal onClose={() => setTarget(null)} labelledBy="restore-title" wide>
          <div className="modal-head">
            <div>
              <span className="up-kind" style={{ color: 'var(--text-faint)' }}>Restaurar respaldo</span>
              <h3 id="restore-title">¿Volver al calendario como estaba antes del {formatInstant(target.created_at)}?</h3>
            </div>
            <button className="icon-btn x" type="button" aria-label="Cerrar" onClick={() => setTarget(null)}>✕</button>
          </div>
          {busy && !preview && <div className="proc"><div><span className="spinner" />Calculando qué cambiaría…</div></div>}
          {message && !message.ok && <div className="alert a-err" role="alert"><ErrorIcon /><div>{message.text}</div></div>}
          {preview && (
            <>
              <div className="note">
                El calendario quedará con {preview.total} eventos: se crearán {preview.created_count}, se actualizarán {preview.updated_count} y se eliminarán {preview.deleted_count}.
                Esta restauración también se guarda en el historial, así que se puede deshacer.
              </div>
              <ChangeList result={preview} />
            </>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setTarget(null)}>Cancelar</button>
            <button className="btn btn-primary" type="button" disabled={!preview || busy} onClick={confirm}>{busy && preview ? 'Restaurando…' : 'Restaurar'}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

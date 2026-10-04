'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import type { RowIssue, SyncResult } from '@/lib/types';
import { formatInstant } from '@/lib/dates';
import { AlertIcon, DownloadIcon, ErrorIcon, FileIcon, OkIcon, UploadIcon } from '../Icons';
import Modal from '../Modal';
import ChangeList, { Summary } from './ChangeList';

type Stage = 'select' | 'validating' | 'invalid' | 'valid' | 'preview' | 'applying' | 'done' | 'failed';

const STEP_OF: Record<Stage, number> = {
  select: 0, validating: 1, invalid: 1, valid: 1, preview: 2, applying: 4, done: 4, failed: 4
};
const STEPS = ['Cargar', 'Validar', 'Vista previa', 'Confirmar', 'Resultado'];
const MAX_BYTES = 4 * 1024 * 1024;
const BIG_DELETE_RATIO = 0.3;

const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default function ImportWizard({ adminName, currentCount }: { adminName: string; currentCount: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>('select');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [errors, setErrors] = useState<RowIssue[]>([]);
  const [warnings, setWarnings] = useState<RowIssue[]>([]);
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [applied, setApplied] = useState<SyncResult | null>(null);
  const [failMessage, setFailMessage] = useState('');
  const [failCode, setFailCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [over, setOver] = useState(false);
  const [fileStored, setFileStored] = useState(true);

  const reset = () => {
    setStage('select'); setFile(null); setFileError(null); setErrors([]); setWarnings([]);
    setPreview(null); setApplied(null); setFailMessage(''); setFailCode(''); setConfirming(false); setTyped('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.xlsx$/i.test(f.name)) {
      setFileError(`«${f.name}» no es un archivo .xlsx. En Excel usa Archivo → Guardar como → «Libro de Excel (.xlsx)».`);
      return;
    }
    if (f.size > MAX_BYTES) {
      setFileError('El archivo pesa más de 4 MB. Elimina hojas, imágenes o filas vacías con formato.');
      return;
    }
    setFileError(null);
    setFile(f);
  };

  const validate = async (f: File | null = file) => {
    if (!f) return;
    setStage('validating');
    const body = new FormData();
    body.append('file', f);
    try {
      const res = await fetch('/api/import/preview', { method: 'POST', body });
      const json = await res.json();
      setWarnings(json.warnings ?? []);
      if (json.ok) {
        setPreview(json.result as SyncResult);
        setStage('valid');
      } else if (json.stage === 'validation') {
        setErrors(json.errors ?? []);
        setStage('invalid');
      } else {
        setFailMessage(json.message ?? 'No se pudo validar el archivo.');
        setFailCode('');
        setStage('failed');
      }
    } catch {
      setFailMessage('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo. No se modificó nada.');
      setFailCode('');
      setStage('failed');
    }
  };

  const apply = async () => {
    if (!file || !preview) return;
    setConfirming(false);
    setStage('applying');
    const body = new FormData();
    body.append('file', file);
    body.append('expectedVersion', String(preview.version));
    try {
      const res = await fetch('/api/import/apply', { method: 'POST', body });
      const json = await res.json();
      if (json.ok) {
        setApplied(json.result as SyncResult);
        setFileStored(Boolean(json.fileStored));
        setStage('done');
        router.refresh();
      } else {
        setFailMessage(json.message ?? 'No se aplicó ningún cambio. El calendario sigue igual.');
        setFailCode(json.code ?? '');
        setStage('failed');
        router.refresh();
      }
    } catch {
      setFailMessage('Se perdió la conexión mientras se aplicaban los cambios. Recarga la página y revisa el historial: la actualización se aplicó completa o no se aplicó, nunca a medias.');
      setFailCode('');
      setStage('failed');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  };

  const step = STEP_OF[stage] + (confirming ? 1 : 0);
  const bigDelete = Boolean(preview && preview.rows_before > 0 && preview.deleted_count / preview.rows_before > BIG_DELETE_RATIO);
  const canConfirm = !bigDelete || typed.trim().toUpperCase() === 'CONFIRMAR';

  const warningBox = warnings.length > 0 && (
    <div className="alert a-warn">
      <AlertIcon />
      <div>
        <b>{warnings.length} {warnings.length === 1 ? 'advertencia' : 'advertencias'} (no impiden continuar)</b>
        {warnings.slice(0, 30).map((w, i) => (
          <div key={i} style={{ marginTop: 4 }}>Fila {w.row} · {w.column}: {w.message}</div>
        ))}
        {warnings.length > 30 && <div style={{ marginTop: 4 }}>y {warnings.length - 30} más.</div>}
      </div>
    </div>
  );

  return (
    <section className="box" aria-labelledby="import-title">
      <div className="box-head">
        <h2 id="import-title">Actualizar calendario con Excel</h2>
        <div className="steps" aria-label="Progreso">
          {STEPS.map((label, i) => (
            <div key={label} className={`step${i === step ? ' on' : i < step ? ' done' : ''}`}>
              <b>{i < step ? '✓' : i + 1}</b>{label}
            </div>
          ))}
        </div>
      </div>

      <div className="stage">
        {stage === 'select' && (
          <>
            <div className="row">
              <a className="btn" href="/api/excel/export"><DownloadIcon />Descargar Excel actual</a>
              <a className="btn btn-ghost" href="/api/excel/template">Descargar plantilla vacía</a>
            </div>
            <div className="note">
              Edita siempre el <b>Excel actual</b>: ya trae los ID de los {currentCount} eventos publicados. Las filas nuevas pueden ir con ID_EVENTO vacío y la app lo asigna.
              El archivo representa el calendario completo: una fila borrada es un evento eliminado.
            </div>
            {file ? (
              <>
                <div className="file">
                  <FileIcon />
                  <div><b>{file.name}</b><span>{sizeLabel(file.size)} · listo para validar</span></div>
                </div>
                <div className="row end">
                  <button className="btn" type="button" onClick={reset}>Cancelar</button>
                  <button className="btn btn-primary" type="button" onClick={() => validate()}>Validar archivo</button>
                </div>
              </>
            ) : (
              <label
                className={`drop${over ? ' over' : ''}`}
                htmlFor="excel-file"
                onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
                onDragOver={(e) => { e.preventDefault(); setOver(true); }}
                onDragLeave={() => setOver(false)}
                onDrop={onDrop}
              >
                <UploadIcon />
                <strong>Arrastra aquí tu archivo .xlsx</strong>
                <span>o haz clic para elegirlo · máximo 4 MB</span>
                <input
                  ref={inputRef}
                  id="excel-file"
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  hidden
                  onChange={(e) => pick(e.target.files?.[0])}
                />
              </label>
            )}
            {fileError && <div className="alert a-err" role="alert"><ErrorIcon /><div><b>Formato no compatible</b>{fileError}</div></div>}
          </>
        )}

        {stage === 'validating' && (
          <div className="proc"><div><span className="spinner" />Revisando {file?.name}… No se modifica nada en este paso.</div></div>
        )}

        {stage === 'invalid' && (
          <>
            <div className="alert a-err" role="alert">
              <ErrorIcon />
              <div><b>Se encontraron {errors.length} {errors.length === 1 ? 'error' : 'errores'}. No se modificó el calendario.</b>Corrige estas filas en tu Excel y vuelve a cargarlo.</div>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Fila</th><th>Columna</th><th>Valor</th><th>Problema</th><th>Cómo corregirlo</th></tr></thead>
                <tbody>
                  {errors.map((e, i) => (
                    <tr key={i}>
                      <td className="num">{e.row || '—'}</td>
                      <td>{e.column}</td>
                      <td>{e.value ? <code>{e.value}</code> : <span style={{ color: 'var(--text-faint)' }}>vacío</span>}</td>
                      <td>{e.message}</td>
                      <td style={{ color: 'var(--text-dim)' }}>{e.fix}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {warningBox}
            <div className="row end"><button className="btn btn-primary" type="button" onClick={reset}>Cargar otro archivo</button></div>
          </>
        )}

        {stage === 'valid' && preview && (
          <>
            <div className="alert a-ok">
              <OkIcon />
              <div><b>Archivo válido: {preview.total} eventos revisados, 0 errores.</b>{warnings.length ? 'Revisa las advertencias antes de continuar.' : 'No hay advertencias.'}</div>
            </div>
            {warningBox}
            <div className="row end">
              <button className="btn" type="button" onClick={reset}>Cancelar</button>
              <button className="btn btn-primary" type="button" onClick={() => setStage('preview')}>Ver vista previa</button>
            </div>
          </>
        )}

        {stage === 'preview' && preview && (
          <>
            <Summary result={preview} />
            {preview.deleted_count > 0 && (
              <div className="alert a-warn">
                <AlertIcon />
                <div>
                  <b>Esta actualización eliminará {preview.deleted_count} {preview.deleted_count === 1 ? 'evento' : 'eventos'}</b>
                  Existen hoy en el calendario pero no aparecen en el archivo nuevo. Revísalos en la pestaña «Se eliminarán».
                </div>
              </div>
            )}
            {preview.created_count + preview.updated_count + preview.deleted_count === 0 && (
              <div className="note">El archivo es idéntico al calendario publicado. Si confirmas, solo quedará registrado en el historial.</div>
            )}
            <ChangeList result={preview} />
            <div className="row end">
              <button className="btn" type="button" onClick={reset}>Cancelar</button>
              <button className="btn btn-primary" type="button" onClick={() => { setTyped(''); setConfirming(true); }}>Confirmar actualización</button>
            </div>
          </>
        )}

        {stage === 'applying' && (
          <div className="proc">
            <div><span className="spinner" />Guardando respaldo y aplicando los cambios en una sola operación…</div>
            <div style={{ color: 'var(--text-faint)' }}>No cierres esta página. Si algo falla, el calendario queda exactamente como estaba.</div>
          </div>
        )}

        {stage === 'done' && applied && (
          <>
            <div className="alert a-ok" role="status">
              <OkIcon />
              <div><b>Calendario actualizado correctamente.</b>Los cambios ya se ven en la página pública.</div>
            </div>
            <div className="sum">
              <div className="stat"><span className="stat-label">Eventos creados</span><span className="stat-num c-new">{applied.created_count}</span></div>
              <div className="stat"><span className="stat-label">Eventos actualizados</span><span className="stat-num c-mod">{applied.updated_count}</span></div>
              <div className="stat"><span className="stat-label">Eventos eliminados</span><span className="stat-num c-del">{applied.deleted_count}</span></div>
              <div className="stat"><span className="stat-label">Eventos totales</span><span className="stat-num">{applied.total}</span></div>
            </div>
            <dl className="kv">
              <dt>Fecha y hora</dt><dd>{applied.applied_at ? formatInstant(applied.applied_at) : '—'}</dd>
              <dt>Realizada por</dt><dd>{adminName}</dd>
              <dt>Estado</dt><dd><span className="badge b-live">Aplicada</span></dd>
              <dt>Respaldo</dt><dd>Guardado. Puedes volver al estado anterior desde el historial.{!fileStored && ' (El archivo Excel original no se pudo guardar, pero los datos sí se respaldaron.)'}</dd>
            </dl>
            <div className="row end">
              <a className="btn" href="/" target="_blank" rel="noopener noreferrer">Ver calendario</a>
              <button className="btn btn-primary" type="button" onClick={reset}>Nueva importación</button>
            </div>
          </>
        )}

        {stage === 'failed' && (
          <>
            <div className="alert a-err" role="alert">
              <ErrorIcon />
              <div><b>No se aplicó ningún cambio. El calendario sigue igual.</b>{failMessage}</div>
            </div>
            <div className="row end">
              <button className="btn" type="button" onClick={reset}>Cargar otro archivo</button>
              {file && <button className="btn btn-primary" type="button" onClick={() => validate(file)}>{failCode === 'VERSION_CONFLICT' ? 'Volver a validar con los datos actuales' : 'Intentar de nuevo'}</button>}
            </div>
          </>
        )}
      </div>

      {confirming && preview && (
        <Modal onClose={() => setConfirming(false)} labelledBy="confirm-title">
          <div className="modal-head">
            <div><span className="up-kind" style={{ color: 'var(--text-faint)' }}>Confirmación</span><h3 id="confirm-title">¿Confirmar actualización del calendario?</h3></div>
          </div>
          <dl className="kv">
            <dt>Se crearán</dt><dd className="c-new num"><b>{preview.created_count} eventos</b></dd>
            <dt>Se actualizarán</dt><dd className="c-mod num"><b>{preview.updated_count} eventos</b></dd>
            <dt>Se eliminarán</dt><dd className="c-del num"><b>{preview.deleted_count} eventos</b></dd>
            <dt>Total después</dt><dd className="num"><b>{preview.total} eventos</b></dd>
          </dl>
          <div className="note">Esta acción reemplazará el estado actual del calendario por la información del archivo cargado. Antes de aplicar se guarda un respaldo.</div>
          {bigDelete && (
            <div className="field">
              <label htmlFor="confirm-word">Se eliminará más del 30 % del calendario. Escribe CONFIRMAR para continuar.</label>
              <input id="confirm-word" className="confirm-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancelar</button>
            <button className="btn btn-primary" type="button" disabled={!canConfirm} onClick={apply}>Confirmar actualización</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

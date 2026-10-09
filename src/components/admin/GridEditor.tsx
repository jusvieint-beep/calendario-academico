'use client';

/**
 * Editor tipo Excel del panel /admin.
 *
 * Muestra el calendario completo como una tabla con las mismas columnas de la
 * plantilla. Se puede editar celda por celda, agregar, duplicar o eliminar filas
 * y pegar bloques copiados desde Excel o Google Sheets.
 *
 * Guardar sigue exactamente el mismo camino seguro que subir un archivo:
 * validación en el servidor → vista previa → confirmación → respaldo →
 * una sola transacción (apply_calendar_import). La tabla representa el
 * calendario completo: una fila eliminada es un evento eliminado.
 */
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { TYPE_LABELS, type CalendarEvent, type RowIssue, type SyncResult, type TypeLabel } from '@/lib/types';
import { COLUMNS, type ColumnKey } from '@/lib/excel/columns';
import { formatInstant } from '@/lib/dates';
import {
  COLUMN_KEYS, applyPaste, dropHeaderRow, emptyCells, eventToCells, isBlankRow, isKnownType,
  isMultiCellPaste, matrixToCells, nextWeekCopy, normalizeType, parseClipboard, rowDate, sameCells,
  sortKey, type GridCells
} from '@/lib/grid';
import { AlertIcon, ErrorIcon, OkIcon } from '../Icons';
import Modal from '../Modal';
import ChangeList, { Summary } from './ChangeList';

interface Row {
  id: number;
  cells: GridCells;
  /** Valores publicados. null = fila nueva. */
  original: GridCells | null;
}

type Stage = 'edit' | 'checking' | 'preview' | 'applying' | 'done' | 'failed';
type IssueMap = Record<number, Partial<Record<string, RowIssue>>>;

const PLACEHOLDER: Partial<Record<ColumnKey, string>> = {
  ID_EVENTO: 'Automático',
  NOMBRE: 'Nombre del evento',
  FECHA: 'dd/mm/aaaa',
  HORA_INICIO: '08:00',
  HORA_FIN: '10:00',
  LINK: 'https://…',
  DESCRIPCION: 'Opcional',
  INSTRUCTOR: 'Opcional'
};
/** Filtro por tipo: nombre visible y color (los mismos del calendario). */
const TYPE_FILTERS: [TypeLabel, string, string, string][] = [
  ['SESION_ZAJUNA', 'Sesiones Zajuna', 'var(--ses)', 'var(--ses-soft)'],
  ['SESION_ADICIONAL', 'Sesiones adicionales', 'var(--adi)', 'var(--adi-soft)'],
  ['DUDAS', 'Dudas', 'var(--dud)', 'var(--dud-soft)'],
  ['GRABACION', 'Grabaciones', 'var(--rec)', 'var(--rec-soft)'],
  ['ENTREGA', 'Entregas', 'var(--ent)', 'var(--ent-soft)'],
  ['CUESTIONARIO', 'Cuestionarios', 'var(--quiz)', 'var(--quiz-soft)'],
  ['FORO', 'Foros', 'var(--foro)', 'var(--foro-soft)']
];
const BIG_DELETE_RATIO = 0.3;
const EMPTY_START_ROWS = 5;
const MAX_LISTED_ERRORS = 15;

/** En entregas, cuestionarios y foros, la hora vacía significa 11:59 PM y la hora de fin no aplica. */
function placeholderFor(key: ColumnKey, category: string): string | undefined {
  if (category === 'GRABACION') {
    if (key === 'HORA_INICIO') return 'Opcional';
    if (key === 'HORA_FIN') return 'No aplica';
    if (key === 'LINK') return 'https://… (enlace a la grabación)';
  }
  if (key === 'INSTRUCTOR') return category === 'SESION_ZAJUNA' || category === 'SESION_ADICIONAL' || category === 'DUDAS' ? 'Quién dicta la sesión' : category === 'GRABACION' ? 'Quién dictó la sesión' : category ? 'No aplica' : 'Opcional';
  if (category === 'DUDAS' && key === 'LINK') return 'https://… (enlace al chat, cuando se tenga)';
  if (category === 'ENTREGA' || category === 'FORO' || category === 'CUESTIONARIO') {
    if (key === 'HORA_INICIO') return '23:59';
    if (key === 'HORA_FIN') return 'No aplica';
    if (key === 'LINK') return category === 'FORO' ? 'https://… (enlace al foro)' : category === 'CUESTIONARIO' ? 'https://… (enlace al cuestionario)' : 'No aplica';
  }
  return PLACEHOLDER[key];
}

let nextRowId = 1;
const makeRow = (cells: GridCells, original: GridCells | null): Row => ({ id: nextRowId++, cells, original });

function rowsFromEvents(events: CalendarEvent[]): Row[] {
  if (!events.length) return Array.from({ length: EMPTY_START_ROWS }, () => makeRow(emptyCells(), null));
  return events.map((e) => {
    const cells = eventToCells(e);
    return makeRow(cells, { ...cells });
  });
}

/** Clase de color de la fila (t-…): igual que en el calendario. */
const categoryOf = (type: string) => (isKnownType(type) ? type : '');

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function GridEditor({ events, today }: { events: CalendarEvent[]; today: string }) {
  const router = useRouter();
  const tableRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<Row[]>(() => rowsFromEvents(events));
  const [removed, setRemoved] = useState<Row[]>([]);
  const [query, setQuery] = useState('');
  const [hidePast, setHidePast] = useState(false);
  /** Tipos seleccionados en el filtro (vacío = todos). Solo cambia lo que se ve; al guardar se usa la tabla completa. */
  const [typeFilter, setTypeFilter] = useState<Set<TypeLabel>>(() => new Set());
  const [issues, setIssues] = useState<IssueMap>({});
  const [generalErrors, setGeneralErrors] = useState<RowIssue[]>([]);
  const [warnings, setWarnings] = useState<RowIssue[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>('edit');
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [applied, setApplied] = useState<SyncResult | null>(null);
  const [failMessage, setFailMessage] = useState('');
  const [failCode, setFailCode] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState('');

  // ---------------------------------------------------------------- estado derivado
  const stats = useMemo(() => {
    let added = 0;
    let changed = 0;
    let total = 0;
    for (const r of rows) {
      if (isBlankRow(r.cells)) continue;
      total++;
      if (!r.original) added++;
      else if (!sameCells(r.cells, r.original)) changed++;
    }
    return { added, changed, removed: removed.length, total };
  }, [rows, removed]);
  const dirty = stats.added + stats.changed + stats.removed > 0;

  const q = query.trim().toLowerCase();
  const filtering = q !== '' || hidePast || typeFilter.size > 0;
  const typeCounts = useMemo(() => {
    const c = {} as Record<string, number>;
    for (const r of rows) if (!isBlankRow(r.cells)) { const t = normalizeType(r.cells.TIPO); c[t] = (c[t] ?? 0) + 1; }
    return c;
  }, [rows]);
  const toggleType = (t: TypeLabel) =>
    setTypeFilter((prev) => { const next = new Set(prev); if (next.has(t)) next.delete(t); else next.add(t); return next; });
  const visible = rows
    .map((r, index) => ({ r, index }))
    .filter(({ r }) => {
      if (!r.original) return true; // las filas nuevas siempre se ven
      if (typeFilter.size && !typeFilter.has(normalizeType(r.cells.TIPO) as TypeLabel)) return false;
      if (hidePast) {
        const d = rowDate(r.cells);
        if (d && d < today) return false;
      }
      if (q) {
        const haystack = `${r.cells.ID_EVENTO} ${r.cells.NOMBRE} ${r.cells.FECHA} ${r.cells.DESCRIPCION} ${r.cells.INSTRUCTOR}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

  const errorList = useMemo(() => {
    const list: { rowId: number; index: number; issue: RowIssue }[] = [];
    rows.forEach((r, index) => {
      const m = issues[r.id];
      if (!m) return;
      for (const key of COLUMN_KEYS) {
        const issue = m[key];
        if (issue) list.push({ rowId: r.id, index, issue });
      }
    });
    return list;
  }, [rows, issues]);

  // ---------------------------------------------------------------- efectos
  // Si el calendario cambia (otra importación) y no hay cambios sin guardar, se recarga la tabla.
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (!dirtyRef.current && stageRef.current === 'edit') resetFrom(events);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Aviso del navegador si se intenta salir con cambios sin guardar.
  useEffect(() => {
    if (!dirty || stage === 'done') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty, stage]);

  // ---------------------------------------------------------------- utilidades
  /** Lleva el cursor a una celda. Reintenta unos instantes si la tabla aún se está actualizando. */
  function focusCell(rowId: number, key: ColumnKey, attempt = 0) {
    window.setTimeout(() => {
      const el = tableRef.current?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-row-id="${rowId}"][data-col="${key}"]`);
      if ((!el || el.disabled) && attempt < 10) { focusCell(rowId, key, attempt + 1); return; }
      el?.focus();
      el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, attempt ? 30 : 0);
  }

  function resetFrom(list: CalendarEvent[]) {
    setRows(rowsFromEvents(list));
    setRemoved([]);
    setIssues({});
    setGeneralErrors([]);
    setWarnings([]);
    setNotice(null);
    setPreview(null);
    setApplied(null);
    setFailMessage('');
    setFailCode('');
    setConfirmDiscard(false);
    setStage('edit');
  }

  function clearIssue(rowId: number, key: ColumnKey) {
    setIssues((prev) => {
      if (!prev[rowId]?.[key]) return prev;
      const next = { ...prev, [rowId]: { ...prev[rowId] } };
      delete next[rowId][key];
      return next;
    });
  }

  // ---------------------------------------------------------------- edición
  function setCell(rowId: number, key: ColumnKey, value: string) {
    setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, cells: { ...r.cells, [key]: value } } : r)));
    clearIssue(rowId, key);
    setConfirmDiscard(false);
  }

  function insertRow(afterIndex: number | null, cells: GridCells = emptyCells(), focus: ColumnKey = 'TIPO') {
    const row = makeRow(cells, null);
    setRows((prev) => {
      const out = [...prev];
      out.splice(afterIndex === null ? out.length : afterIndex + 1, 0, row);
      return out;
    });
    focusCell(row.id, focus);
  }

  function deleteRow(rowId: number) {
    const row = rows.find((r) => r.id === rowId);
    if (!row) return;
    setRows((prev) => prev.filter((r) => r.id !== rowId));
    if (row.original) setRemoved((prev) => [...prev, row]);
    setIssues((prev) => {
      if (!prev[rowId]) return prev;
      const next = { ...prev };
      delete next[rowId];
      return next;
    });
  }

  function restoreRemoved() {
    setRows((prev) => [...prev, ...removed]);
    setRemoved([]);
  }

  function sortByDate() {
    setRows((prev) => [...prev].sort((a, b) => {
      const ka = isBlankRow(a.cells) ? '~' : sortKey(a.cells);
      const kb = isBlankRow(b.cells) ? '~' : sortKey(b.cells);
      return ka < kb ? -1 : ka > kb ? 1 : 0;
    }));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement | HTMLSelectElement>, vIndex: number, key: ColumnKey) {
    const isSelect = e.currentTarget.tagName === 'SELECT';
    let target: number;
    if (e.key === 'Enter') target = vIndex + (e.shiftKey ? -1 : 1);
    else if (!isSelect && e.key === 'ArrowDown') target = vIndex + 1;
    else if (!isSelect && e.key === 'ArrowUp') target = vIndex - 1;
    else return;
    e.preventDefault();
    if (target < 0) return;
    if (target >= visible.length) {
      if (e.key === 'Enter') insertRow(null, emptyCells(), key);
      return;
    }
    focusCell(visible[target].r.id, key);
  }

  function onCellPaste(e: ClipboardEvent<HTMLInputElement>, index: number, colIndex: number) {
    const text = e.clipboardData.getData('text/plain');
    if (!isMultiCellPaste(text)) return; // pegado normal dentro de una celda
    e.preventDefault();
    if (filtering) {
      setNotice('Quita la búsqueda y los filtros (tipo y eventos pasados) para pegar varias celdas.');
      return;
    }
    const matrix = dropHeaderRow(parseClipboard(text));
    if (!matrix.length) return;
    const result = applyPaste(rows.map((r) => r.cells), index, colIndex, matrix, (i) => !rows[i]?.original);
    setRows((prev) => result.rows.map((cells, i) => (i < prev.length ? { ...prev[i], cells } : makeRow(cells, null))));
    setIssues({});
    setNotice(`Se pegaron ${plural(result.touched, 'fila', 'filas')}${result.added ? ` (${result.added} nuevas)` : ''}. Revisa los datos y pulsa «Revisar y guardar».`);
  }

  const pastedRows = useMemo(() => matrixToCells(parseClipboard(pasteText)), [pasteText]);

  function addPastedRows() {
    if (!pastedRows.length) return;
    const newRows = pastedRows.map((cells) => makeRow(cells, null));
    setRows((prev) => [...prev.filter((r) => r.original || !isBlankRow(r.cells)), ...newRows]);
    setIssues({});
    setPasteOpen(false);
    setPasteText('');
    setNotice(`Se agregaron ${plural(newRows.length, 'fila nueva', 'filas nuevas')} al final de la tabla. Revisa los datos y pulsa «Revisar y guardar».`);
    focusCell(newRows[0].id, 'NOMBRE');
  }

  // ---------------------------------------------------------------- guardar
  const payload = () => rows.map((r) => r.cells);

  async function review() {
    setStage('checking');
    setGeneralErrors([]);
    setNotice(null);
    setConfirmDiscard(false);
    const snapshot = rows;
    try {
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload() })
      });
      const json = await res.json();
      // Solo se muestran advertencias de filas nuevas o modificadas: avisar que un evento
      // publicado y sin tocar ya pasó no aporta nada al editar.
      const touched = (n: number) => {
        const r = snapshot[n - 1];
        return !r || !r.original || !sameCells(r.cells, r.original);
      };
      setWarnings(((json.warnings ?? []) as RowIssue[]).filter((w) => w.row === 0 || touched(w.row)));
      if (json.ok) {
        setIssues({});
        setPreview(json.result as SyncResult);
        setStage('preview');
        return;
      }
      if (json.stage === 'validation') {
        const map: IssueMap = {};
        const general: RowIssue[] = [];
        let first: { id: number; key: ColumnKey } | null = null;
        for (const issue of (json.errors ?? []) as RowIssue[]) {
          const row = issue.row > 0 ? snapshot[issue.row - 1] : undefined;
          if (!row || !(COLUMN_KEYS as string[]).includes(issue.column)) { general.push(issue); continue; }
          map[row.id] = { ...map[row.id], [issue.column]: map[row.id]?.[issue.column] ?? issue };
          if (!first) first = { id: row.id, key: issue.column as ColumnKey };
        }
        setIssues(map);
        setGeneralErrors(general);
        setQuery('');
        setHidePast(false);
        setTypeFilter(new Set());
        setStage('edit');
        if (first) focusCell(first.id, first.key);
        return;
      }
      setFailMessage(json.message ?? 'No se pudo revisar la tabla.');
      setFailCode('');
      setStage('failed');
    } catch {
      setFailMessage('No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo. No se modificó nada.');
      setFailCode('');
      setStage('failed');
    }
  }

  async function apply() {
    if (!preview) return;
    setConfirming(false);
    setStage('applying');
    try {
      const res = await fetch('/api/import/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: payload(), expectedVersion: preview.version })
      });
      const json = await res.json();
      if (json.ok) {
        setApplied(json.result as SyncResult);
        setStage('done');
      } else {
        setFailMessage(json.message ?? 'No se aplicó ningún cambio. El calendario sigue igual.');
        setFailCode(json.code ?? '');
        setStage('failed');
      }
      router.refresh();
    } catch {
      setFailMessage('Se perdió la conexión mientras se guardaban los cambios. Recarga la página y revisa el historial: la actualización se aplicó completa o no se aplicó, nunca a medias.');
      setFailCode('');
      setStage('failed');
    }
  }

  const bigDelete = Boolean(preview && preview.rows_before > 0 && preview.deleted_count / preview.rows_before > BIG_DELETE_RATIO);
  const canConfirm = !bigDelete || typed.trim().toUpperCase() === 'CONFIRMAR';

  const warningBox = warnings.length > 0 && (
    <div className="alert a-warn">
      <AlertIcon />
      <div>
        <b>{plural(warnings.length, 'advertencia', 'advertencias')} (no impiden guardar)</b>
        {warnings.slice(0, 20).map((w, i) => (
          <div key={i} style={{ marginTop: 4 }}>Fila {w.row} · {w.column}: {w.message}</div>
        ))}
        {warnings.length > 20 && <div style={{ marginTop: 4 }}>y {warnings.length - 20} más.</div>}
      </div>
    </div>
  );

  // ---------------------------------------------------------------- vista
  const editing = stage === 'edit' || stage === 'checking';

  return (
    <section className="box" aria-labelledby="grid-title">
      <div className="box-head">
        <div>
          <h2 id="grid-title">Editar en la plataforma</h2>
          <span className="stat-sub">Mismas columnas que la plantilla de Excel. Los cambios se publican solo después de revisarlos y confirmarlos.</span>
        </div>
      </div>

      {editing && (
        <>
          <div className="sheet-tools">
            <input
              id="grid-search"
              className="sheet-search"
              type="search"
              placeholder="Buscar por nombre, ID, fecha o descripción"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Buscar en la tabla"
            />
            <label className="check-label" htmlFor="grid-hide-past">
              <input id="grid-hide-past" type="checkbox" checked={hidePast} onChange={(e) => setHidePast(e.target.checked)} />
              Ocultar eventos pasados
            </label>
            <div className="row" style={{ marginLeft: 'auto' }}>
              <button className="btn" type="button" onClick={() => insertRow(null)} disabled={stage === 'checking'}>+ Agregar fila</button>
              <button className="btn" type="button" onClick={() => { setPasteText(''); setPasteOpen(true); }} disabled={stage === 'checking'}>Pegar desde Excel</button>
              <button className="btn btn-ghost" type="button" onClick={sortByDate} disabled={stage === 'checking'}>Ordenar por fecha</button>
            </div>
          </div>

          <div className="type-filter" role="group" aria-label="Filtrar por tipo de evento (puedes elegir varios)">
            <span className="type-filter-label">Tipo:</span>
            <button
              type="button"
              className={`chip${typeFilter.size === 0 ? ' active' : ''}`}
              aria-pressed={typeFilter.size === 0}
              onClick={() => setTypeFilter(new Set())}
            >
              Todos <span className="count">{stats.total}</span>
            </button>
            {TYPE_FILTERS.map(([t, label, c, bg]) => (
              <button
                key={t}
                type="button"
                className={`chip${typeFilter.has(t) ? ' active' : ''}`}
                aria-pressed={typeFilter.has(t)}
                style={{ ['--chip-c' as string]: c, ['--chip-bg' as string]: bg }}
                onClick={() => toggleType(t)}
              >
                <span className="dot" style={{ background: c }} />{label} <span className="count">{typeCounts[t] ?? 0}</span>
              </button>
            ))}
            {typeFilter.size > 1 && <span className="stat-sub">{typeFilter.size} tipos seleccionados</span>}
          </div>

          {notice && <div className="note" role="status">{notice}</div>}

          {(generalErrors.length > 0 || errorList.length > 0) && (
            <div className="alert a-err" role="alert">
              <ErrorIcon />
              <div>
                <b>Hay {plural(generalErrors.length + errorList.length, 'error', 'errores')}. No se guardó nada.</b>
                Corrige las celdas marcadas en rojo y vuelve a pulsar «Revisar y guardar».
                <div className="err-list">
                  {generalErrors.map((e, i) => <div key={`g${i}`}>{e.message} {e.fix}</div>)}
                  {errorList.slice(0, MAX_LISTED_ERRORS).map(({ rowId, index, issue }) => (
                    <button key={`${rowId}-${issue.column}`} type="button" className="err-link" onClick={() => focusCell(rowId, issue.column as ColumnKey)}>
                      Fila {index + 1} · {issue.column}: {issue.message} <span className="err-fix">{issue.fix}</span>
                    </button>
                  ))}
                  {errorList.length > MAX_LISTED_ERRORS && <div>y {errorList.length - MAX_LISTED_ERRORS} más (marcados en rojo).</div>}
                </div>
              </div>
            </div>
          )}

          <div className="table-wrap sheet-wrap" ref={tableRef}>
            <table className="sheet">
              <thead>
                <tr>
                  <th className="rn" scope="col">#</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" className={`c-${c.key}`} title={c.hint}>
                      {c.key}{c.required && <span className="req" aria-hidden="true"> *</span>}
                    </th>
                  ))}
                  <th className="act" scope="col"><span className="sr-only">Acciones</span></th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ r, index }, vIndex) => {
                  const rowIssues = issues[r.id];
                  const blank = isBlankRow(r.cells);
                  const status = !r.original ? (blank ? 'blank' : 'new') : sameCells(r.cells, r.original) ? '' : 'mod';
                  const cat = categoryOf(r.cells.TIPO);
                  return (
                    <tr key={r.id} className={`${status}${cat ? ` t-${cat}` : ''}`}>
                      <td className="rn num" title={status === 'new' ? 'Fila nueva' : status === 'mod' ? 'Fila modificada' : undefined}>{index + 1}</td>
                      {COLUMN_KEYS.map((key, colIndex) => {
                        const issue = rowIssues?.[key];
                        const changed = Boolean(r.original && r.cells[key].trim() !== r.original[key].trim());
                        const cls = `sc${issue ? ' bad' : ''}${changed ? ' edited' : ''}`;
                        const label = `${key}, fila ${index + 1}`;
                        const tip = issue ? `${issue.message} ${issue.fix}` : changed && r.original ? `Antes: ${r.original[key] || 'vacío'}` : undefined;

                        if (key === 'ID_EVENTO' && r.original) {
                          return <td key={key} className="sc id num" title="El ID de un evento publicado no se cambia">{r.cells.ID_EVENTO}</td>;
                        }
                        if (key === 'TIPO') {
                          const v = r.cells.TIPO;
                          return (
                            <td key={key} className={cls} title={tip}>
                              <select
                                data-row-id={r.id}
                                data-col={key}
                                aria-label={label}
                                aria-invalid={Boolean(issue)}
                                value={v}
                                disabled={stage === 'checking'}
                                onChange={(e) => setCell(r.id, key, e.target.value)}
                                onKeyDown={(e) => onKey(e, vIndex, key)}
                              >
                                <option value="">—</option>
                                {TYPE_LABELS.map((t) => <option key={t} value={t}>{t}</option>)}
                                {v && !isKnownType(v) && <option value={v}>{v} (no válido)</option>}
                              </select>
                            </td>
                          );
                        }
                        return (
                          <td key={key} className={cls} title={tip}>
                            <input
                              data-row-id={r.id}
                              data-col={key}
                              aria-label={label}
                              aria-invalid={Boolean(issue)}
                              value={r.cells[key]}
                              placeholder={placeholderFor(key, cat)}
                              disabled={stage === 'checking'}
                              spellCheck={key === 'NOMBRE' || key === 'DESCRIPCION' || key === 'INSTRUCTOR'}
                              inputMode={key === 'FECHA' || key === 'HORA_INICIO' || key === 'HORA_FIN' ? 'numeric' : key === 'LINK' ? 'url' : undefined}
                              autoComplete="off"
                              onChange={(e) => setCell(r.id, key, key === 'TIPO' ? normalizeType(e.target.value) : e.target.value)}
                              onKeyDown={(e) => onKey(e, vIndex, key)}
                              onPaste={(e) => onCellPaste(e, index, colIndex)}
                            />
                          </td>
                        );
                      })}
                      <td className="act">
                        <button type="button" className="cell-btn" title="Duplicar para la semana siguiente (misma hora, fecha + 7 días)" aria-label={`Duplicar fila ${index + 1} para la semana siguiente`} disabled={stage === 'checking' || blank} onClick={() => insertRow(index, nextWeekCopy(r.cells), 'FECHA')}>+7 días</button>
                        <button type="button" className="cell-btn del" title="Eliminar fila" aria-label={`Eliminar fila ${index + 1}`} disabled={stage === 'checking'} onClick={() => deleteRow(r.id)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {visible.length === 0 && (
              <div className="empty"><b>Ninguna fila coincide con la búsqueda</b>Cambia el texto o quita el filtro de eventos pasados.</div>
            )}
          </div>

          <div className="sheet-foot">
            <div className="sheet-sum">
              <b>{plural(stats.total, 'evento', 'eventos')}</b>
              {dirty ? (
                <> · <span className="c-new">{stats.added} nuevos</span> · <span className="c-mod">{stats.changed} modificados</span> · <span className="c-del">{stats.removed} eliminados</span> · sin guardar</>
              ) : (
                <> · sin cambios</>
              )}
              {filtering && <> · mostrando {visible.length}</>}
              {removed.length > 0 && (
                <> · <button type="button" className="err-link" onClick={restoreRemoved}>recuperar filas eliminadas</button></>
              )}
            </div>
            <div className="row">
              {dirty && !confirmDiscard && (
                <button className="btn btn-ghost" type="button" onClick={() => setConfirmDiscard(true)} disabled={stage === 'checking'}>Descartar cambios</button>
              )}
              {confirmDiscard && (
                <>
                  <span className="stat-sub">¿Descartar todos los cambios?</span>
                  <button className="btn" type="button" onClick={() => setConfirmDiscard(false)}>No</button>
                  <button className="btn btn-danger" type="button" onClick={() => resetFrom(events)}>Sí, descartar</button>
                </>
              )}
              <button className="btn btn-primary" type="button" disabled={!dirty || stage === 'checking'} onClick={review}>
                {stage === 'checking' ? <><span className="spinner" style={{ width: 14, height: 14, flexBasis: 14 }} />Revisando…</> : 'Revisar y guardar'}
              </button>
            </div>
          </div>
        </>
      )}

      {stage === 'preview' && preview && (
        <div className="stage">
          <div className="alert a-ok">
            <OkIcon />
            <div><b>La tabla no tiene errores.</b>Esto es lo que cambiará en el calendario publicado. Nada se aplica hasta que confirmes.</div>
          </div>
          <Summary result={preview} sourceLabel="Eventos en la tabla" />
          {preview.deleted_count > 0 && (
            <div className="alert a-warn">
              <AlertIcon />
              <div>
                <b>{preview.deleted_count === 1 ? 'Se eliminará 1 evento' : `Se eliminarán ${preview.deleted_count} eventos`}</b>
                Están publicados pero ya no aparecen en la tabla. Revísalos en la pestaña «Se eliminarán».
              </div>
            </div>
          )}
          {warningBox}
          <ChangeList result={preview} />
          <div className="row end">
            <button className="btn" type="button" onClick={() => setStage('edit')}>Volver a editar</button>
            <button className="btn btn-primary" type="button" onClick={() => { setTyped(''); setConfirming(true); }}>Confirmar cambios</button>
          </div>
        </div>
      )}

      {stage === 'applying' && (
        <div className="proc">
          <div><span className="spinner" />Guardando respaldo y aplicando los cambios en una sola operación…</div>
          <div style={{ color: 'var(--text-faint)' }}>No cierres esta página. Si algo falla, el calendario queda exactamente como estaba.</div>
        </div>
      )}

      {stage === 'done' && applied && (
        <div className="stage">
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
            <dt>Origen</dt><dd>Edición en la plataforma</dd>
            <dt>Respaldo</dt><dd>Guardado. Puedes deshacer este cambio desde el historial.</dd>
          </dl>
          <div className="row end">
            <a className="btn" href="/" target="_blank" rel="noopener noreferrer">Ver calendario</a>
            <button className="btn btn-primary" type="button" onClick={() => resetFrom(events)}>Seguir editando</button>
          </div>
        </div>
      )}

      {stage === 'failed' && (
        <div className="stage">
          <div className="alert a-err" role="alert">
            <ErrorIcon />
            <div><b>No se guardó ningún cambio. El calendario sigue igual.</b>{failMessage}</div>
          </div>
          {failCode === 'VERSION_CONFLICT' && (
            <div className="note">
              Otra actualización se aplicó mientras revisabas. Tus cambios siguen en la tabla. Puedes revisarlos de nuevo
              (la vista previa mostrará también lo que cambió la otra actualización) o descartarlos y cargar los datos actuales.
            </div>
          )}
          <div className="row end">
            {failCode === 'VERSION_CONFLICT' && <button className="btn" type="button" onClick={() => resetFrom(events)}>Descartar y cargar datos actuales</button>}
            <button className="btn" type="button" onClick={() => setStage('edit')}>Volver a editar</button>
            <button className="btn btn-primary" type="button" onClick={review}>Revisar de nuevo</button>
          </div>
        </div>
      )}

      {confirming && preview && (
        <Modal onClose={() => setConfirming(false)} labelledBy="grid-confirm-title">
          <div className="modal-head">
            <div><span className="up-kind" style={{ color: 'var(--text-faint)' }}>Confirmación</span><h3 id="grid-confirm-title">¿Guardar los cambios en el calendario?</h3></div>
          </div>
          <dl className="kv">
            <dt>Se crearán</dt><dd className="c-new num"><b>{plural(preview.created_count, 'evento', 'eventos')}</b></dd>
            <dt>Se actualizarán</dt><dd className="c-mod num"><b>{plural(preview.updated_count, 'evento', 'eventos')}</b></dd>
            <dt>Se eliminarán</dt><dd className="c-del num"><b>{plural(preview.deleted_count, 'evento', 'eventos')}</b></dd>
            <dt>Total después</dt><dd className="num"><b>{plural(preview.total, 'evento', 'eventos')}</b></dd>
          </dl>
          <div className="note">El calendario publicado quedará igual a esta tabla. Antes de aplicar se guarda un respaldo.</div>
          {bigDelete && (
            <div className="field">
              <label htmlFor="grid-confirm-word">Se eliminará más del 30 % del calendario. Escribe CONFIRMAR para continuar.</label>
              <input id="grid-confirm-word" className="confirm-word" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setConfirming(false)}>Cancelar</button>
            <button className="btn btn-primary" type="button" disabled={!canConfirm} onClick={apply}>Confirmar cambios</button>
          </div>
        </Modal>
      )}

      {pasteOpen && (
        <Modal onClose={() => setPasteOpen(false)} labelledBy="paste-title" wide>
          <div className="modal-head">
            <div><span className="up-kind" style={{ color: 'var(--text-faint)' }}>Agregar filas</span><h3 id="paste-title">Pegar desde Excel</h3></div>
            <button className="icon-btn x" type="button" aria-label="Cerrar" onClick={() => setPasteOpen(false)}>✕</button>
          </div>
          <div className="note">
            En Excel o Google Sheets selecciona las filas, cópialas (Ctrl+C) y pégalas aquí (Ctrl+V). Puedes incluir la fila de
            encabezados de la plantilla. Se agregan al final de la tabla como eventos nuevos.
          </div>
          <label className="sr-only" htmlFor="paste-area">Filas copiadas de Excel</label>
          <textarea
            id="paste-area"
            className="paste-area"
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={'SESION_ZAJUNA\tMatemáticas II\t05/10/2026\t08:00\t10:00\thttps://meet.google.com/abc\tUnidad 3'}
          />
          {pasteText.trim() !== '' && (
            <div className="stat-sub">
              {pastedRows.length
                ? <>Se detectaron <b>{plural(pastedRows.length, 'fila', 'filas')}</b>. Primera: {pastedRows[0].TIPO || '—'} · {pastedRows[0].NOMBRE || 'sin nombre'} · {pastedRows[0].FECHA || 'sin fecha'}</>
                : 'No se detectaron filas con datos.'}
            </div>
          )}
          <div className="modal-actions">
            <button className="btn" type="button" onClick={() => setPasteOpen(false)}>Cancelar</button>
            <button className="btn btn-primary" type="button" disabled={!pastedRows.length} onClick={addPastedRows}>
              {pastedRows.length ? `Agregar ${plural(pastedRows.length, 'fila', 'filas')}` : 'Agregar filas'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

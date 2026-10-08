import { SESSION_TYPES, TYPE_LIST_TEXT, resolveType, type ImportRow, type RowIssue, type TypeLabel } from '../types';
import { formatDateShort } from '../dates';
import { MAX_ROWS, type ColumnKey } from './columns';
import { cellToLink, cellToText, displayValue, isEmptyCell, parseDateCell, parseTimeCell } from './normalize';

export interface RawRow {
  /** Número de fila en Excel */
  row: number;
  cells: Record<ColumnKey, unknown>;
}

export interface ValidationResult {
  rows: ImportRow[];
  errors: RowIssue[];
  warnings: RowIssue[];
}

export const ID_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;
const TITLE_MAX = 150;
const DESCRIPTION_MAX = 2000;

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

export function validateRows(raw: RawRow[], today: string): ValidationResult {
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const rows: ImportRow[] = [];
  const seenIds = new Map<string, number>();
  const seenSignature = new Map<string, number>();

  const err = (row: number, column: string, value: unknown, message: string, fix: string) =>
    errors.push({ row, column, value: displayValue(value), message, fix });
  const warn = (row: number, column: string, value: unknown, message: string, fix = '') =>
    warnings.push({ row, column, value: displayValue(value), message, fix });

  const dataRows = raw.filter((r) => !Object.values(r.cells).every(isEmptyCell));

  if (dataRows.length === 0) {
    err(0, 'Archivo', '', 'El archivo no tiene filas con datos.', 'Escribe los eventos desde la fila 2 de la hoja «Calendario».');
    return { rows, errors, warnings };
  }
  if (dataRows.length > MAX_ROWS) {
    err(0, 'Archivo', String(dataRows.length), `El archivo tiene ${dataRows.length} filas; el máximo es ${MAX_ROWS}.`, 'Divide el calendario o elimina filas antiguas.');
    return { rows, errors, warnings };
  }

  for (const { row, cells } of dataRows) {
    const before = errors.length;

    // ID_EVENTO
    const idText = cellToText(cells.ID_EVENTO);
    let eventId: string | null = null;
    if (idText) {
      if (!ID_PATTERN.test(idText)) {
        err(row, 'ID_EVENTO', cells.ID_EVENTO, 'El ID tiene caracteres no permitidos o es muy largo.', 'Usa solo letras, números, guion, punto o guion bajo (máx. 40). O déjalo vacío para que la app lo asigne.');
      } else if (seenIds.has(idText.toUpperCase())) {
        err(row, 'ID_EVENTO', cells.ID_EVENTO, `Este ID ya aparece en la fila ${seenIds.get(idText.toUpperCase())}.`, 'Cada evento necesita un ID distinto. Deja la celda vacía y la app asignará uno nuevo.');
      } else {
        seenIds.set(idText.toUpperCase(), row);
        eventId = idText;
      }
    }

    // TIPO. Se acepta «Sesión Zajuna», «sesion zajuna» o «SESION_ZAJUNA». Los nombres antiguos
    // (SESION, CLASE, ENTREGA) se aceptan con aviso y se guardan con el nombre oficial.
    const typeRaw = cellToText(cells.TIPO);
    const resolved = resolveType(typeRaw);
    let type: TypeLabel | null = null;
    if (!resolved.key) {
      err(row, 'TIPO', cells.TIPO, 'Falta el tipo de evento.', `Elige ${TYPE_LIST_TEXT} en la lista desplegable.`);
    } else if (!resolved.label) {
      err(row, 'TIPO', cells.TIPO, 'Tipo no reconocido.', `Elige ${TYPE_LIST_TEXT} en la lista desplegable.`);
    } else {
      type = resolved.label;
      if (resolved.aliased) {
        warn(row, 'TIPO', cells.TIPO, `El tipo «${typeRaw.trim()}» ahora se llama ${type}. Se guardará como ${type}.`, `Escribe ${type} en la columna TIPO.`);
      }
    }
    const isSession = type !== null && SESSION_TYPES.includes(type);
    const isRecording = type === 'GRABACION';
    const isDoubts = type === 'DUDAS';

    // NOMBRE
    const title = cellToText(cells.NOMBRE).replace(/\s+/g, ' ');
    if (!title) err(row, 'NOMBRE', cells.NOMBRE, 'Falta el nombre del evento.', 'Escribe el nombre que verán los estudiantes.');
    else if (title.length > TITLE_MAX) err(row, 'NOMBRE', cells.NOMBRE, `El nombre tiene ${title.length} caracteres; el máximo es ${TITLE_MAX}.`, 'Acórtalo y usa DESCRIPCION para el detalle.');

    // FECHA
    let date: string | null = null;
    if (isEmptyCell(cells.FECHA)) {
      err(row, 'FECHA', cells.FECHA, 'Falta la fecha.', 'Escribe la fecha como dd/mm/aaaa, por ejemplo 05/10/2026.');
    } else {
      const parsed = parseDateCell(cells.FECHA);
      if (parsed.ok) date = parsed.value;
      else err(row, 'FECHA', cells.FECHA, 'La fecha no es válida o no existe.', 'Usa el formato dd/mm/aaaa, por ejemplo 05/10/2026.');
    }

    // HORAS
    let start: string | null = null;
    let end: string | null = null;
    const startParsed = parseTimeCell(cells.HORA_INICIO);
    if (!startParsed.ok) err(row, 'HORA_INICIO', cells.HORA_INICIO, 'La hora no es válida.', 'Escribe la hora en formato 24 h, por ejemplo 08:00 o 14:30.');
    else start = startParsed.value;

    const endParsed = parseTimeCell(cells.HORA_FIN);
    if (!endParsed.ok) err(row, 'HORA_FIN', cells.HORA_FIN, 'La hora no es válida.', 'Escribe la hora en formato 24 h, por ejemplo 10:00.');
    else end = endParsed.value;

    if (isSession && startParsed.ok && !start) {
      err(row, 'HORA_INICIO', cells.HORA_INICIO, isDoubts ? 'Los espacios de dudas necesitan hora de inicio.' : 'Las sesiones necesitan hora de inicio.', 'Escribe la hora de inicio, por ejemplo 08:00.');
    }
    if (type && !isSession && end) {
      // Grabaciones, trabajos, cuestionarios y foros no usan hora de fin.
      warn(row, 'HORA_FIN', cells.HORA_FIN, `${isRecording ? 'Las grabaciones' : 'Los trabajos, cuestionarios y foros'} no usan hora de fin; se ignorará.`, isRecording ? 'Si quieres indicar desde qué hora está disponible, escríbela en HORA_INICIO.' : 'Si quieres una hora límite, escríbela en HORA_INICIO.');
      end = null;
    }
    if (isSession && start && end && end <= start) {
      err(row, 'HORA_FIN', cells.HORA_FIN, `La hora de fin es igual o anterior a la de inicio (${start}).`, 'Corrige la hora de fin o déjala vacía.');
    }

    // LINK
    const link = cellToLink(cells.LINK);
    if (link) {
      let valid = false;
      try {
        const u = new URL(link);
        valid = (u.protocol === 'https:' || u.protocol === 'http:') && Boolean(u.hostname);
      } catch {
        valid = false;
      }
      if (!valid) err(row, 'LINK', cells.LINK, 'El enlace no tiene un formato válido.', 'Copia el enlace completo, empezando por https://');
    } else if (isDoubts) {
      warn(row, 'LINK', '', `El espacio de dudas «${title || 'Sin nombre'}» no tiene enlace al chat. Se publicará sin botón «Ir al chat de dudas»; agrégalo cuando lo tengas.`);
    } else if (isSession) {
      warn(row, 'LINK', '', `«${title || 'Sin nombre'}» no tiene enlace. Se publicará sin botón «Ingresar».`);
    } else if (isRecording) {
      warn(row, 'LINK', '', `La grabación «${title || 'Sin nombre'}» no tiene enlace. Se publicará sin botón «Ver grabación».`);
    }

    // DESCRIPCION
    const description = cellToText(cells.DESCRIPCION);
    if (description.length > DESCRIPTION_MAX) {
      err(row, 'DESCRIPCION', cells.DESCRIPCION, `La descripción tiene ${description.length} caracteres; el máximo es ${DESCRIPTION_MAX}.`, 'Acórtala.');
    }

    if (errors.length > before || !type || !date) continue;

    if (date < today) {
      warn(row, 'FECHA', cells.FECHA, `«${title}» tiene fecha pasada (${formatDateShort(date)}). Se mostrará como finalizada o vencida.`);
    }

    // Duplicados: mismo tipo (sesión Zajuna, sesión adicional, dudas, grabación, trabajo, cuestionario o foro), nombre, fecha y hora → error, no se guarda.
    // El nombre se compara sin mayúsculas, tildes ni espacios repetidos.
    const signature = [
      type === 'TRABAJO' || !type ? 'TRABAJO' : type,
      stripAccents(title).toLowerCase(),
      date,
      start ?? (isSession ? '' : 'sin hora')
    ].join('|');
    const firstRow = seenSignature.get(signature);
    if (firstRow !== undefined) {
      err(
        row, 'NOMBRE', title,
        `Evento duplicado: la fila ${firstRow} ya tiene ${type === 'SESION_ZAJUNA' ? 'una sesión Zajuna' : type === 'SESION_ADICIONAL' ? 'una sesión adicional' : isDoubts ? 'un espacio de dudas' : isRecording ? 'una grabación' : type === 'FORO' ? 'un foro' : type === 'CUESTIONARIO' ? 'un cuestionario' : 'un trabajo'} «${title}» el ${formatDateShort(date)}${start ? ` a las ${start}` : ' sin hora'}.`,
        'Elimina una de las dos filas. Si son eventos distintos, cambia el nombre o la hora.'
      );
      continue;
    }
    seenSignature.set(signature, row);

    rows.push({
      event_id: eventId,
      type_label: type,
      title,
      event_date: date,
      start_time: start,
      end_time: isSession ? end : null,
      link: link || null,
      description: description || null
    });
  }

  return { rows: errors.length ? [] : rows, errors, warnings };
}

import { TYPE_LABELS, type ImportRow, type RowIssue, type TypeLabel } from '../types';
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

    // TIPO
    const typeText = stripAccents(cellToText(cells.TIPO)).toUpperCase();
    let type: TypeLabel | null = null;
    if (!typeText) {
      err(row, 'TIPO', cells.TIPO, 'Falta el tipo de evento.', 'Elige CLASE, SESION, TRABAJO, ENTREGA o FORO en la lista desplegable.');
    } else if (!(TYPE_LABELS as readonly string[]).includes(typeText)) {
      err(row, 'TIPO', cells.TIPO, 'Tipo no reconocido.', 'Elige CLASE, SESION, TRABAJO, ENTREGA o FORO en la lista desplegable.');
    } else {
      type = typeText as TypeLabel;
    }
    const isSession = type === 'CLASE' || type === 'SESION';

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
      err(row, 'HORA_INICIO', cells.HORA_INICIO, 'Las clases y sesiones necesitan hora de inicio.', 'Escribe la hora de inicio, por ejemplo 08:00.');
    }
    if (type && !isSession && end) {
      warn(row, 'HORA_FIN', cells.HORA_FIN, 'Los trabajos y entregas no usan hora de fin; se ignorará.', 'Si quieres una hora límite, escríbela en HORA_INICIO.');
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
    } else if (isSession) {
      warn(row, 'LINK', '', `«${title || 'Sin nombre'}» no tiene enlace. Se publicará sin botón «Ingresar».`);
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

    // Duplicados: mismo tipo (clase/sesión, trabajo/entrega o foro), nombre, fecha y hora → error, no se guarda.
    // El nombre se compara sin mayúsculas, tildes ni espacios repetidos.
    const signature = [
      isSession ? 'SESION' : type === 'FORO' ? 'FORO' : 'ENTREGA',
      stripAccents(title).toLowerCase(),
      date,
      start ?? (isSession ? '' : 'sin hora')
    ].join('|');
    const firstRow = seenSignature.get(signature);
    if (firstRow !== undefined) {
      err(
        row, 'NOMBRE', title,
        `Evento duplicado: la fila ${firstRow} ya tiene ${isSession ? 'una clase o sesión' : type === 'FORO' ? 'un foro' : 'un trabajo o entrega'} «${title}» el ${formatDateShort(date)}${start ? ` a las ${start}` : ' sin hora'}.`,
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

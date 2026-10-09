/**
 * SESION: en vivo con horario (Sesión Zajuna, Sesión adicional y Dudas)
 * · GRABACION: material disponible desde una fecha · ENTREGA: con fecha límite.
 */
export type Category = 'SESION' | 'GRABACION' | 'ENTREGA';
export type TypeLabel = 'SESION_ZAJUNA' | 'SESION_ADICIONAL' | 'DUDAS' | 'GRABACION' | 'ENTREGA' | 'CUESTIONARIO' | 'FORO';

export const TYPE_LABELS: readonly TypeLabel[] = ['SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS', 'GRABACION', 'ENTREGA', 'CUESTIONARIO', 'FORO'];

/** Tipos que se guardan con categoría SESION (en vivo, hora de inicio obligatoria). */
export const SESSION_TYPES: readonly TypeLabel[] = ['SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS'];

/** Texto para mensajes: «SESION_ZAJUNA, SESION_ADICIONAL, DUDAS, GRABACION, ENTREGA, CUESTIONARIO o FORO». */
export const TYPE_LIST_TEXT = `${TYPE_LABELS.slice(0, -1).join(', ')} o ${TYPE_LABELS[TYPE_LABELS.length - 1]}`;

/**
 * Nombres antiguos o abreviados que se siguen aceptando (Excel o respaldos viejos) y se guardan
 * con el nombre oficial, con aviso: SESION y CLASE → SESION_ZAJUNA, TRABAJO → ENTREGA.
 */
export const TYPE_ALIASES: Readonly<Record<string, TypeLabel>> = {
  SESION: 'SESION_ZAJUNA',
  CLASE: 'SESION_ZAJUNA',
  ZAJUNA: 'SESION_ZAJUNA',
  ADICIONAL: 'SESION_ADICIONAL',
  SESION_ADICIONALES: 'SESION_ADICIONAL',
  DUDA: 'DUDAS',
  TRABAJO: 'ENTREGA',
  TRABAJOS: 'ENTREGA',
  ENTREGAS: 'ENTREGA'
};

const stripAccents = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

/** «Sesión Zajuna», «sesion-adicional», «Dudas» → «SESION_ZAJUNA», «SESION_ADICIONAL», «DUDAS» (sin aplicar alias). */
export const typeKey = (value: string) => stripAccents(value).trim().toUpperCase().replace(/[\s-]+/g, '_');

/**
 * Convierte lo que se escribió en la columna TIPO en el tipo oficial.
 * `aliased` = se escribió un nombre antiguo o abreviado (se avisa); `label` = null si no es un tipo conocido.
 */
export function resolveType(value: string): { key: string; label: TypeLabel | null; aliased: boolean } {
  const key = typeKey(value);
  if ((TYPE_LABELS as readonly string[]).includes(key)) return { key, label: key as TypeLabel, aliased: false };
  const alias = TYPE_ALIASES[key];
  return { key, label: alias ?? null, aliased: Boolean(alias) };
}

/**
 * Cómo se ve un evento. Entregas, cuestionarios y foros se guardan con categoría ENTREGA
 * (tienen fecha límite), pero cada uno tiene color, ícono y filtro propios.
 */
export type Kind = 'SESION_ZAJUNA' | 'SESION_ADICIONAL' | 'DUDAS' | 'GRABACION' | 'ENTREGA' | 'CUESTIONARIO' | 'FORO';

/** Evento tal como lo usa la interfaz. Fechas y horas en hora local de Colombia. */
export interface CalendarEvent {
  event_id: string;
  category: Category;
  type_label: TypeLabel;
  title: string;
  /** YYYY-MM-DD */
  event_date: string;
  /** HH:MM (24 h) o null */
  start_time: string | null;
  end_time: string | null;
  link: string | null;
  description: string | null;
  /** Persona que dicta la sesión (solo Sesión Zajuna y Sesión adicional). */
  instructor: string | null;
}

/** Tipos que pueden tener instructor. */
export const INSTRUCTOR_TYPES: readonly TypeLabel[] = ['SESION_ZAJUNA', 'SESION_ADICIONAL'];

/** Fila del Excel ya validada y normalizada, lista para enviar a Supabase. */
export interface ImportRow {
  event_id: string | null;
  type_label: TypeLabel;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  link: string | null;
  description: string | null;
  /** undefined = el archivo no trae la columna INSTRUCTOR: se conserva el instructor guardado. */
  instructor?: string | null;
}

export interface RowIssue {
  /** Número de fila en Excel (1 = encabezados). 0 = problema del archivo completo. */
  row: number;
  column: string;
  value: string;
  message: string;
  fix: string;
}

export interface EventSummary {
  event_id: string;
  type_label: TypeLabel;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time?: string | null;
  auto_id?: boolean;
}

export interface EventFields {
  type_label: TypeLabel;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  link: string | null;
  description: string | null;
  instructor?: string | null;
}

/** Respuesta de las funciones SQL apply_calendar_import / restore_snapshot. */
export interface SyncResult {
  dry_run: boolean;
  version: number;
  import_id: string | null;
  rows_before: number;
  total: number;
  sessions: number;
  deliveries: number;
  /** Grabaciones (versiones anteriores de la función SQL no lo envían). */
  recordings?: number;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  unchanged_count: number;
  created: EventSummary[];
  updated: { event_id: string; before: EventFields; after: EventFields }[];
  deleted: EventSummary[];
  applied_at: string | null;
}

export interface ImportRecord {
  id: string;
  admin_email: string | null;
  kind: 'import' | 'restore';
  status: 'applied' | 'failed';
  file_name: string | null;
  rows_before: number | null;
  rows_after: number | null;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  unchanged_count: number;
  error_message: string | null;
  restored_from: string | null;
  created_at: string;
  has_snapshot: boolean;
}

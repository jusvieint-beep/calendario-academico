export const SHEET_NAME = 'Calendario';
export const MAX_FILE_BYTES = 4 * 1024 * 1024; // 4 MB (límite de Vercel por petición: 4,5 MB)
export const MAX_ROWS = 2000;
export const TEMPLATE_ROWS = 1000;

export type ColumnKey =
  | 'ID_EVENTO' | 'TIPO' | 'NOMBRE' | 'FECHA' | 'HORA_INICIO' | 'HORA_FIN' | 'LINK' | 'DESCRIPCION';

export interface ColumnDef {
  key: ColumnKey;
  required: boolean;
  width: number;
  hint: string;
}

export const COLUMNS: ColumnDef[] = [
  { key: 'ID_EVENTO', required: false, width: 13, hint: 'Déjalo vacío en filas nuevas: la app asigna EVT-0001, EVT-0002… No cambies los ID existentes.' },
  { key: 'TIPO', required: true, width: 12, hint: 'Elige de la lista: CLASE, SESION, TRABAJO o ENTREGA.' },
  { key: 'NOMBRE', required: true, width: 36, hint: 'Nombre que verán los estudiantes. Máximo 150 caracteres.' },
  { key: 'FECHA', required: true, width: 13, hint: 'Formato dd/mm/aaaa. Ejemplo: 05/10/2026.' },
  { key: 'HORA_INICIO', required: false, width: 13, hint: 'Obligatoria para CLASE y SESION (hh:mm, 24 h). En TRABAJO/ENTREGA es la hora límite; vacía = 11:59 PM.' },
  { key: 'HORA_FIN', required: false, width: 11, hint: 'Opcional. Debe ser posterior a HORA_INICIO. Solo aplica a clases y sesiones.' },
  { key: 'LINK', required: false, width: 40, hint: 'Opcional. Debe empezar por https:// o http://' },
  { key: 'DESCRIPCION', required: false, width: 46, hint: 'Opcional. Máximo 2.000 caracteres.' }
];

/** 'Hora inicio', 'HORA-INICIO', 'Descripción' → 'HORA_INICIO', 'DESCRIPCION' */
export function normalizeHeader(value: string): string {
  return value
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .trim().toUpperCase()
    .replace(/[\s\-.]+/g, '_');
}

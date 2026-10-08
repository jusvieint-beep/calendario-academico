import ExcelJS from 'exceljs';
import { TYPE_LABELS, TYPE_LIST_TEXT, type CalendarEvent } from '../types';
import { COLUMNS, SHEET_NAME, TEMPLATE_ROWS } from './columns';

const FONT = 'Arial';
const DARK = 'FF1F1F1F';
const GREY = 'FF4A4A4A';
const YELLOW = 'FFEFF422';
const WHITE = 'FFFFFFFF';
const LINE = 'FFD0D0D0';

const excelDate = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const excelTime = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return new Date(Date.UTC(1899, 11, 30, h, m));
};

/**
 * Genera el Excel oficial. Sin eventos = plantilla vacía.
 * Con eventos = «Excel actual» con sus ID, listo para editar y volver a subir.
 */
export async function buildCalendarWorkbook(events: CalendarEvent[] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Calendario Académico';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_NAME, {
    properties: { tabColor: { argb: YELLOW } },
    views: [{ state: 'frozen', ySplit: 1 }]
  });
  ws.columns = COLUMNS.map((c) => ({ header: c.key, key: c.key, width: c.width }));

  const header = ws.getRow(1);
  header.height = 22;
  COLUMNS.forEach((c, i) => {
    const cell = header.getCell(i + 1);
    cell.font = { name: FONT, bold: true, size: 10, color: { argb: c.required ? YELLOW : WHITE } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? DARK : GREY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  ws.autoFilter = { from: 'A1', to: 'H1' };

  events.forEach((e) => {
    ws.addRow({
      ID_EVENTO: e.event_id,
      TIPO: e.type_label,
      NOMBRE: e.title,
      FECHA: excelDate(e.event_date),
      HORA_INICIO: e.start_time ? excelTime(e.start_time) : null,
      HORA_FIN: e.end_time ? excelTime(e.end_time) : null,
      LINK: e.link ?? null,
      DESCRIPCION: e.description ?? null
    });
  });

  const lastRow = Math.max(TEMPLATE_ROWS, events.length + 200);
  for (let r = 2; r <= lastRow; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = row.getCell(c);
      cell.font = { name: FONT, size: 10 };
      cell.border = { bottom: { style: 'thin', color: { argb: LINE } } };
    }
    row.getCell(1).numFmt = '@';
    row.getCell(4).numFmt = 'dd/mm/yyyy';
    row.getCell(5).numFmt = 'hh:mm';
    row.getCell(6).numFmt = 'hh:mm';

    row.getCell(2).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`"${TYPE_LABELS.join(',')}"`],
      showErrorMessage: true, errorTitle: 'Tipo no válido', error: `Usa ${TYPE_LIST_TEXT}.`,
      showInputMessage: true, promptTitle: 'TIPO', prompt: COLUMNS[1].hint
    };
    row.getCell(4).dataValidation = {
      type: 'date', operator: 'between', allowBlank: true,
      formulae: [new Date(Date.UTC(2020, 0, 1)), new Date(Date.UTC(2040, 11, 31))],
      showErrorMessage: true, errorTitle: 'Fecha no válida', error: 'Escribe la fecha como dd/mm/aaaa, por ejemplo 05/10/2026.',
      showInputMessage: true, promptTitle: 'FECHA', prompt: COLUMNS[3].hint
    };
    for (const c of [5, 6]) {
      row.getCell(c).dataValidation = {
        type: 'time', operator: 'between', allowBlank: true, formulae: [0, 0.999988],
        showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Hora no válida',
        error: 'Escribe la hora como hh:mm en formato 24 h, por ejemplo 08:00 o 14:30.',
        showInputMessage: true, promptTitle: COLUMNS[c - 1].key, prompt: COLUMNS[c - 1].hint
      };
    }
  }

  // Hoja de instrucciones.
  const ins = wb.addWorksheet('Instrucciones', { properties: { tabColor: { argb: GREY } }, views: [{ showGridLines: false }] });
  ins.getColumn(1).width = 2;
  ins.getColumn(2).width = 110;
  const lines: [string, 'title' | 'h' | 'p'][] = [
    ['Plantilla del Calendario Académico', 'title'],
    ['', 'p'],
    ['Cómo usar este archivo', 'h'],
    ['1. Escribe cada sesión, grabación, entrega, cuestionario o foro en una fila de la hoja «Calendario», desde la fila 2.', 'p'],
    ['2. Los encabezados en amarillo son obligatorios. Los grises son opcionales.', 'p'],
    ['3. Deja ID_EVENTO vacío en las filas nuevas. La app asigna el ID al importar.', 'p'],
    ['4. Guarda como Libro de Excel (.xlsx) y súbelo en el panel /admin.', 'p'],
    ['5. Revisa la vista previa y confirma. Antes de aplicar, la app guarda un respaldo.', 'p'],
    ['', 'p'],
    ['Reglas importantes', 'h'],
    ['• Este archivo es el calendario completo. Si borras una fila, ese evento se elimina del calendario al importar.', 'p'],
    ['• Para editar después, descarga el «Excel actual» desde /admin: ya trae los ID. No reutilices archivos viejos.', 'p'],
    ['• No cambies el nombre de la hoja «Calendario» ni los encabezados de la fila 1.', 'p'],
    ['• Fechas y horas de Colombia (UTC-5). Horas en formato 24 h: 08:00, 14:30, 23:59.', 'p'],
    ['• SESION_ZAJUNA (prioritaria), SESION_ADICIONAL y DUDAS (espacio de dudas por chat) necesitan HORA_INICIO. GRABACION se muestra desde su fecha (hora opcional). En ENTREGA, CUESTIONARIO y FORO, HORA_INICIO es la hora límite; vacía = 11:59 PM.', 'p'],
    ['• Un archivo con errores no modifica nada. La app indica fila, columna y cómo corregir cada error.', 'p']
  ];
  lines.forEach(([text, kind], i) => {
    const cell = ins.getCell(i + 2, 2);
    cell.value = text;
    cell.font = { name: FONT, size: kind === 'title' ? 16 : kind === 'h' ? 12 : 10, bold: kind !== 'p' };
  });

  wb.views = [{ x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, activeTab: 0, visibility: 'visible' }];
  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

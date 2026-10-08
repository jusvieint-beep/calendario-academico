/**
 * Pruebas de la lógica que no depende de Next.js ni de Supabase:
 * lectura de celdas de Excel, validación de filas y reglas del calendario.
 *
 * Ejecutar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDateCell, parseTimeCell, cellToLink, cellToText } from '../src/lib/excel/normalize.ts';
import { validateRows, type RawRow } from '../src/lib/excel/validate.ts';
import { normalizeHeader } from '../src/lib/excel/columns.ts';
import { upcoming, isLive, isPast, isPriority, compareEvents, deliveryStatus, kindOf, kindName } from '../src/lib/events.ts';
import { formatTime, keyToMs } from '../src/lib/dates.ts';
import { resolveType, type CalendarEvent } from '../src/lib/types.ts';

const TODAY = '2026-10-03';

function row(n: number, c: Partial<Record<string, unknown>>): RawRow {
  return {
    row: n,
    cells: {
      ID_EVENTO: null, TIPO: null, NOMBRE: null, FECHA: null,
      HORA_INICIO: null, HORA_FIN: null, LINK: null, DESCRIPCION: null,
      ...c
    } as RawRow['cells']
  };
}

test('fecha: Excel guarda 5/10/2026 como 46300 y nunca se corre al 4', () => {
  assert.deepEqual(parseDateCell(46300), { ok: true, value: '2026-10-05' });
  // ExcelJS entrega fechas como Date en UTC medianoche
  assert.deepEqual(parseDateCell(new Date(Date.UTC(2026, 9, 5))), { ok: true, value: '2026-10-05' });
  assert.deepEqual(parseDateCell('05/10/2026'), { ok: true, value: '2026-10-05' });
  assert.deepEqual(parseDateCell('5-10-2026'), { ok: true, value: '2026-10-05' });
  assert.deepEqual(parseDateCell('2026-10-05'), { ok: true, value: '2026-10-05' });
});

test('fecha: rechaza fechas que no existen', () => {
  assert.equal(parseDateCell('35/15/2026').ok, false);
  assert.equal(parseDateCell('31/04/2026').ok, false);
  assert.equal(parseDateCell('29/02/2026').ok, false);
  assert.equal(parseDateCell('29/02/2028').ok, true);
  assert.equal(parseDateCell('mañana').ok, false);
});

test('hora: acepta formato 24 h, AM/PM y horas de Excel', () => {
  assert.deepEqual(parseTimeCell('08:00'), { ok: true, value: '08:00' });
  assert.deepEqual(parseTimeCell('8:00 AM'), { ok: true, value: '08:00' });
  assert.deepEqual(parseTimeCell('2:30 p. m.'), { ok: true, value: '14:30' });
  assert.deepEqual(parseTimeCell('12:00 am'), { ok: true, value: '00:00' });
  assert.deepEqual(parseTimeCell(0.5), { ok: true, value: '12:00' });
  assert.deepEqual(parseTimeCell(new Date(Date.UTC(1899, 11, 30, 23, 59))), { ok: true, value: '23:59' });
  assert.deepEqual(parseTimeCell(null), { ok: true, value: null });
  assert.equal(parseTimeCell('25:00').ok, false);
  assert.equal(parseTimeCell('8').ok, false);
  assert.equal(parseTimeCell('10:75').ok, false);
});

test('celdas especiales: hipervínculos, texto enriquecido y fórmulas', () => {
  assert.equal(cellToLink({ text: 'Clase', hyperlink: 'https://meet.google.com/abc' }), 'https://meet.google.com/abc');
  assert.equal(cellToText({ richText: [{ text: 'Mate' }, { text: 'máticas' }] }), 'Matemáticas');
  assert.equal(cellToText({ formula: 'A1', result: 'Taller' }), 'Taller');
});

test('encabezados: tolera tildes, espacios y guiones', () => {
  assert.equal(normalizeHeader('Hora inicio'), 'HORA_INICIO');
  assert.equal(normalizeHeader('Descripción'), 'DESCRIPCION');
  assert.equal(normalizeHeader(' id-evento '), 'ID_EVENTO');
});

test('validación: archivo correcto produce filas normalizadas', () => {
  const r = validateRows([
    row(2, { TIPO: 'clase', NOMBRE: 'Matemáticas', FECHA: '05/10/2026', HORA_INICIO: '08:00', HORA_FIN: '10:00', LINK: 'https://meet.google.com/x' }),
    row(3, { ID_EVENTO: 'EVT-0002', TIPO: 'TRABAJO', NOMBRE: 'Taller 2', FECHA: '06/10/2026', HORA_INICIO: '23:59' }),
    row(4, { TIPO: 'Sesión', NOMBRE: 'Tutoría', FECHA: '10/10/2026', HORA_INICIO: '10:00' }),
    row(5, {}), // fila vacía: se ignora
    row(6, { TIPO: 'CUESTIONARIO', NOMBRE: 'Informe', FECHA: '08/10/2026' })
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 4);
  assert.deepEqual(r.rows[0], {
    event_id: null, type_label: 'SESION_ZAJUNA', title: 'Matemáticas', event_date: '2026-10-05',
    start_time: '08:00', end_time: '10:00', link: 'https://meet.google.com/x', description: null
  });
  // CLASE es el nombre antiguo de SESION: se acepta y se avisa.
  assert.ok(r.warnings.some((w) => w.row === 2 && w.column === 'TIPO' && w.message.includes('SESION_ZAJUNA')));
  assert.equal(r.rows[2].type_label, 'SESION_ZAJUNA');
  assert.equal(r.rows[3].start_time, null); // entrega sin hora: vence 23:59 en la base de datos
  // advertencia: sesión sin enlace (fila 4)
  assert.ok(r.warnings.some((w) => w.row === 4 && w.column === 'LINK'));
});

test('validación: los errores del documento de requisitos se detectan con fila y columna', () => {
  const r = validateRows([
    row(5, { ID_EVENTO: 'EVT-004', TIPO: 'SESION_ZAJUNA', NOMBRE: 'A', FECHA: '05/10/2026', HORA_INICIO: '08:00' }),
    row(8, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'B', FECHA: '35/15/2026', HORA_INICIO: '08:00' }),
    row(12, { ID_EVENTO: 'evt-004', TIPO: 'SESION_ZAJUNA', NOMBRE: 'C', FECHA: '05/10/2026', HORA_INICIO: '09:00' }),
    row(15, { TIPO: 'REUNIONX', NOMBRE: 'D', FECHA: '05/10/2026' }),
    row(19, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'E', FECHA: '05/10/2026' }),
    row(21, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'F', FECHA: '05/10/2026', HORA_INICIO: '09:00', HORA_FIN: '07:00' }),
    row(22, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'G', FECHA: '05/10/2026', HORA_INICIO: '09:00', LINK: 'meet.google.com/x' }),
    row(23, { TIPO: 'TRABAJO', FECHA: '05/10/2026' })
  ], TODAY);
  const at = (rowN: number, col: string) => r.errors.some((e) => e.row === rowN && e.column === col);
  assert.ok(at(8, 'FECHA'), 'fecha inválida');
  assert.ok(at(12, 'ID_EVENTO'), 'ID duplicado (sin importar mayúsculas)');
  assert.ok(at(15, 'TIPO'), 'tipo no válido');
  assert.ok(at(19, 'HORA_INICIO'), 'sesión sin hora');
  assert.ok(at(21, 'HORA_FIN'), 'fin antes del inicio');
  assert.ok(at(22, 'LINK'), 'enlace sin https');
  assert.ok(at(23, 'NOMBRE'), 'nombre vacío');
  assert.equal(r.rows.length, 0, 'con errores no se envía ninguna fila');
  for (const e of r.errors) assert.ok(e.message && e.fix, 'cada error explica el problema y cómo corregirlo');
});

test('validación: archivo vacío es un error (no puede borrar el calendario)', () => {
  const r = validateRows([row(2, {}), row(3, {})], TODAY);
  assert.equal(r.errors.length, 1);
  assert.equal(r.errors[0].row, 0);
});

test('validación: advierte fechas pasadas', () => {
  const r = validateRows([
    row(2, { TIPO: 'TRABAJO', NOMBRE: 'Taller 1', FECHA: '30/09/2026', HORA_INICIO: '23:59' })
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.ok(r.warnings.some((w) => w.row === 2 && w.message.includes('fecha pasada')));
});

test('duplicados: mismo tipo, nombre, fecha y hora bloquean el guardado', () => {
  const r = validateRows([
    row(2, { TIPO: 'CLASE', NOMBRE: 'Matemáticas II', FECHA: '05/10/2026', HORA_INICIO: '08:00' }),
    row(3, { TIPO: 'sesion', NOMBRE: '  matematicas   ii ', FECHA: '5/10/2026', HORA_INICIO: '8:00 AM' }), // CLASE (nombre antiguo) y SESION = mismo tipo; sin tildes/mayúsculas/espacios
    row(4, { TIPO: 'TRABAJO', NOMBRE: 'Informe', FECHA: '08/10/2026' }),
    row(5, { TIPO: 'trabajo', NOMBRE: 'INFORME', FECHA: '08/10/2026' }) // ambos sin hora
  ], TODAY);
  const dup = r.errors.filter((e) => e.message.startsWith('Evento duplicado'));
  assert.deepEqual(dup.map((e) => [e.row, e.column]), [[3, 'NOMBRE'], [5, 'NOMBRE']]);
  assert.match(dup[0].message, /fila 2/);
  assert.ok(dup[0].fix.length > 0);
  assert.equal(r.rows.length, 0, 'con duplicados no se guarda nada');
});

test('duplicados: no son duplicados si cambia el tipo, la hora o la fecha', () => {
  const r = validateRows([
    row(2, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'Proyecto', FECHA: '05/10/2026', HORA_INICIO: '08:00' }),
    row(3, { TIPO: 'CUESTIONARIO', NOMBRE: 'Proyecto', FECHA: '05/10/2026', HORA_INICIO: '08:00' }), // otro tipo
    row(4, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'Proyecto', FECHA: '05/10/2026', HORA_INICIO: '14:00' }), // otra hora
    row(5, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'Proyecto', FECHA: '12/10/2026', HORA_INICIO: '08:00' }), // otra fecha
    row(6, { TIPO: 'TRABAJO', NOMBRE: 'Taller', FECHA: '06/10/2026' }),
    row(7, { TIPO: 'TRABAJO', NOMBRE: 'Taller', FECHA: '06/10/2026', HORA_INICIO: '18:00' }) // sin hora ≠ 18:00
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 6);
});

test('grabaciones: hora opcional, sin hora de fin, aviso sin enlace y duplicados aparte de las sesiones', () => {
  const r = validateRows([
    row(2, { TIPO: 'Grabación', NOMBRE: 'Clase 1', FECHA: '06/10/2026' }),
    row(3, { TIPO: 'GRABACION', NOMBRE: 'Clase 2', FECHA: '06/10/2026', HORA_INICIO: '18:00', HORA_FIN: '20:00', LINK: 'https://youtu.be/x' }),
    row(4, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'Clase 2', FECHA: '06/10/2026', HORA_INICIO: '18:00' }) // misma clave, otro tipo: no es duplicado
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows.length, 3);
  assert.equal(r.rows[0].type_label, 'GRABACION');
  assert.equal(r.rows[0].start_time, null, 'la hora es opcional');
  assert.equal(r.rows[1].end_time, null, 'la hora de fin se ignora');
  assert.ok(r.warnings.some((w) => w.row === 2 && w.column === 'LINK' && w.message.includes('Ver grabación')));
  assert.ok(r.warnings.some((w) => w.row === 3 && w.column === 'HORA_FIN'));

  const d = validateRows([
    row(2, { TIPO: 'GRABACION', NOMBRE: 'Clase 1', FECHA: '06/10/2026' }),
    row(3, { TIPO: 'grabacion', NOMBRE: 'clase 1', FECHA: '06/10/2026' })
  ], TODAY);
  assert.match(d.errors[0]?.message ?? '', /una grabación/);
});

const ev = (p: Partial<CalendarEvent>): CalendarEvent => ({
  event_id: p.event_id ?? Math.random().toString(36).slice(2),
  category: 'SESION', type_label: 'SESION_ZAJUNA', title: 'X', event_date: '2026-10-05',
  start_time: null, end_time: null, link: null, description: null, ...p
});

test('próximas actividades: orden real, máximo 5, sin vencidas (reglas D1 y D6)', () => {
  const now = { date: '2026-10-05', time: '15:00' };
  const list = [
    ev({ event_id: 'manana-8am', event_date: '2026-10-06', start_time: '08:00' }),
    ev({ event_id: 'hoy-4pm', event_date: '2026-10-05', start_time: '16:00' }),
    ev({ event_id: 'entrega-hoy-1159', category: 'ENTREGA', type_label: 'TRABAJO', event_date: '2026-10-05', start_time: '23:59' }),
    ev({ event_id: 'entrega-hoy-sin-hora', category: 'ENTREGA', type_label: 'CUESTIONARIO', event_date: '2026-10-05' }),
    ev({ event_id: 'en-curso', event_date: '2026-10-05', start_time: '14:00', end_time: '16:00' }),
    ev({ event_id: 'terminada', event_date: '2026-10-05', start_time: '13:00', end_time: '14:30' }),
    ev({ event_id: 'sin-fin-hace-2h', event_date: '2026-10-05', start_time: '13:00' }),
    ev({ event_id: 'vencida', category: 'ENTREGA', type_label: 'TRABAJO', event_date: '2026-10-04', start_time: '23:59' }),
    ev({ event_id: 'lejana', event_date: '2026-10-20', start_time: '08:00' })
  ];
  const ids = upcoming(list, now).map((e) => e.event_id);
  assert.deepEqual(ids, ['en-curso', 'hoy-4pm', 'entrega-hoy-1159', 'entrega-hoy-sin-hora', 'manana-8am']);
  assert.equal(isLive(list[4], now), true);
});

test('estado de entregas: vence pronto (<48 h) y vencido', () => {
  const now = { date: '2026-10-05', time: '10:00' };
  const nowMs = keyToMs('2026-10-05T10:00');
  const pronto = ev({ category: 'ENTREGA', type_label: 'TRABAJO', event_date: '2026-10-06', start_time: '08:00' });
  const lejos = ev({ category: 'ENTREGA', type_label: 'TRABAJO', event_date: '2026-10-10', start_time: '08:00' });
  const pasada = ev({ category: 'ENTREGA', type_label: 'TRABAJO', event_date: '2026-10-04' });
  assert.equal(deliveryStatus(pronto, now, nowMs).status, 'pronto');
  assert.equal(deliveryStatus(lejos, now, nowMs).status, 'pendiente');
  assert.equal(deliveryStatus(pasada, now, nowMs).status, 'vencido');
});

test('formato de hora para la interfaz', () => {
  assert.equal(formatTime('08:00'), '8:00 AM');
  assert.equal(formatTime('23:59'), '11:59 PM');
  assert.equal(formatTime('12:00'), '12:00 PM');
});

test('FORO: se acepta, la hora es opcional (límite 11:59 PM) y es un tipo distinto para duplicados', () => {
  const r = validateRows([
    row(2, { TIPO: 'foro', NOMBRE: 'Foro unidad 2', FECHA: '07/10/2026', LINK: 'https://campus.edu.co/foro/2' }),
    row(3, { TIPO: 'TRABAJO', NOMBRE: 'Foro unidad 2', FECHA: '07/10/2026' }), // mismo nombre, otro tipo → no es duplicado
    row(4, { TIPO: 'FORO', NOMBRE: 'Debate final', FECHA: '09/10/2026', HORA_INICIO: '18:00', HORA_FIN: '19:00' })
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.equal(r.rows[0].type_label, 'FORO');
  assert.equal(r.rows[0].start_time, null);
  assert.equal(r.rows[0].link, 'https://campus.edu.co/foro/2');
  assert.equal(r.rows[2].end_time, null, 'el foro no usa hora de fin');
  assert.ok(!r.warnings.some((w) => w.row === 2 && w.column === 'LINK'), 'un foro sin enlace no genera advertencia de sesión');

  const dup = validateRows([
    row(2, { TIPO: 'FORO', NOMBRE: 'Debate', FECHA: '09/10/2026' }),
    row(3, { TIPO: 'Foro', NOMBRE: 'debate', FECHA: '09/10/2026' })
  ], TODAY);
  assert.equal(dup.errors.length, 1);
  assert.match(dup.errors[0].message, /un foro/);
});

test('FORO: se ve como foro pero vence como una entrega', () => {
  const now = { date: '2026-10-07', time: '10:00' };
  const foro = ev({ event_id: 'f', category: 'ENTREGA', type_label: 'FORO', event_date: '2026-10-07' });
  assert.equal(kindOf(foro), 'FORO');
  assert.equal(kindOf(ev({ category: 'ENTREGA', type_label: 'TRABAJO' })), 'ENTREGA');
  assert.equal(kindOf(ev({})), 'SESION_ZAJUNA');
  assert.equal(kindName(foro), 'Foro');
  assert.equal(deliveryStatus(foro, now, keyToMs('2026-10-07T10:00')).status, 'pronto');
  assert.deepEqual(upcoming([foro], now).map((e) => e.event_id), ['f']);
  assert.equal(upcoming([foro], { date: '2026-10-08', time: '00:00' }).length, 0, 'vencido a las 11:59 PM');
});

test('CUESTIONARIO: reemplaza a ENTREGA, es un tipo propio y vence como un trabajo', () => {
  const r = validateRows([
    row(2, { TIPO: 'cuestionario', NOMBRE: 'Quiz unidad 2', FECHA: '08/10/2026', LINK: 'https://campus.edu.co/quiz/2' }),
    row(3, { TIPO: 'Entrega', NOMBRE: 'Parcial 1', FECHA: '09/10/2026', HORA_INICIO: '20:00' }), // nombre antiguo
    row(4, { TIPO: 'TRABAJO', NOMBRE: 'Quiz unidad 2', FECHA: '08/10/2026' }) // mismo nombre, otro tipo
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.rows.map((x) => x.type_label), ['CUESTIONARIO', 'CUESTIONARIO', 'TRABAJO']);
  assert.ok(r.warnings.some((w) => w.row === 3 && w.column === 'TIPO' && /ahora se llama CUESTIONARIO/.test(w.message)));

  const dup = validateRows([
    row(2, { TIPO: 'CUESTIONARIO', NOMBRE: 'Parcial', FECHA: '09/10/2026' }),
    row(3, { TIPO: 'ENTREGA', NOMBRE: 'parcial', FECHA: '09/10/2026' })
  ], TODAY);
  assert.equal(dup.errors.length, 1);
  assert.match(dup.errors[0].message, /un cuestionario/);

  const quiz = ev({ category: 'ENTREGA', type_label: 'CUESTIONARIO', event_date: '2026-10-08' });
  assert.equal(kindOf(quiz), 'CUESTIONARIO');
  assert.equal(kindName(quiz), 'Cuestionario');
  assert.equal(kindOf(ev({ category: 'ENTREGA', type_label: 'ENTREGA' as never })), 'CUESTIONARIO', 'datos antiguos se ven como cuestionario');
  assert.equal(upcoming([quiz], { date: '2026-10-08', time: '23:58' }).length, 1);
  assert.equal(upcoming([quiz], { date: '2026-10-09', time: '00:00' }).length, 0);
});

test('grabaciones: no salen en próximas actividades, nunca vencen y tienen su propio tipo', () => {
  const now = { date: '2026-10-05', time: '15:00' };
  const rec = ev({ event_id: 'g', category: 'GRABACION', type_label: 'GRABACION', event_date: '2026-09-01' });
  const futura = ev({ event_id: 'g2', category: 'GRABACION', type_label: 'GRABACION', event_date: '2026-10-09', start_time: '10:00' });
  assert.deepEqual(upcoming([rec, futura], now), []);
  assert.equal(isPast(rec, now), false);
  assert.equal(kindOf(rec), 'GRABACION');
  assert.equal(kindName(rec), 'Grabación');
  assert.equal(kindName(ev({ type_label: 'CLASE' as CalendarEvent['type_label'] })), 'Sesión Zajuna', 'eventos antiguos CLASE se muestran como Sesión Zajuna');
});

test('tipos: se aceptan con tildes, espacios o guiones; los nombres antiguos se convierten con aviso', () => {
  assert.deepEqual(resolveType('Sesión Zajuna'), { key: 'SESION_ZAJUNA', label: 'SESION_ZAJUNA', aliased: false });
  assert.equal(resolveType(' sesion-adicional ').label, 'SESION_ADICIONAL');
  assert.equal(resolveType('Dudas').label, 'DUDAS');
  assert.deepEqual(resolveType('SESION'), { key: 'SESION', label: 'SESION_ZAJUNA', aliased: true });
  assert.equal(resolveType('clase').label, 'SESION_ZAJUNA');
  assert.equal(resolveType('Reunión').label, null);
});

test('Sesión Zajuna, Sesión adicional y Dudas: hora de inicio obligatoria, hora de fin permitida y avisos de enlace', () => {
  const r = validateRows([
    row(2, { TIPO: 'Sesión Zajuna', NOMBRE: 'Matemáticas', FECHA: '06/10/2026', HORA_INICIO: '08:00', HORA_FIN: '10:00', LINK: 'https://zajuna.sena.edu.co/x' }),
    row(3, { TIPO: 'SESION_ADICIONAL', NOMBRE: 'Refuerzo', FECHA: '06/10/2026', HORA_INICIO: '14:00', HORA_FIN: '15:00' }),
    row(4, { TIPO: 'DUDAS', NOMBRE: 'Resolución de dudas', FECHA: '07/10/2026', HORA_INICIO: '18:00', HORA_FIN: '19:00' }),
    row(5, { TIPO: 'SESION', NOMBRE: 'Antigua', FECHA: '08/10/2026', HORA_INICIO: '08:00' })
  ], TODAY);
  assert.equal(r.errors.length, 0);
  assert.deepEqual(r.rows.map((x) => x.type_label), ['SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS', 'SESION_ZAJUNA']);
  assert.equal(r.rows[2].end_time, '19:00', 'dudas guarda la hora de fin');
  assert.ok(r.warnings.some((w) => w.row === 4 && w.column === 'LINK' && w.message.includes('chat')), 'dudas sin enlace: aviso, no error');
  assert.ok(r.warnings.some((w) => w.row === 5 && w.column === 'TIPO'), 'SESION se convierte a SESION_ZAJUNA con aviso');
  assert.ok(!r.warnings.some((w) => w.row === 2 && w.column === 'TIPO'), '«Sesión Zajuna» escrito con tilde y espacio no genera aviso');

  const e = validateRows([row(2, { TIPO: 'DUDAS', NOMBRE: 'Dudas', FECHA: '07/10/2026' })], TODAY);
  assert.ok(e.errors.some((x) => x.column === 'HORA_INICIO' && x.message.includes('dudas')));

  const d = validateRows([
    row(2, { TIPO: 'SESION_ZAJUNA', NOMBRE: 'Física', FECHA: '07/10/2026', HORA_INICIO: '08:00' }),
    row(3, { TIPO: 'SESION_ADICIONAL', NOMBRE: 'Física', FECHA: '07/10/2026', HORA_INICIO: '08:00' }), // otro tipo: no es duplicado
    row(4, { TIPO: 'sesion zajuna', NOMBRE: 'fisica', FECHA: '07/10/2026', HORA_INICIO: '08:00' })
  ], TODAY);
  assert.deepEqual(d.errors.map((x) => x.row), [4]);
  assert.match(d.errors[0].message, /una sesión Zajuna/);
});

test('Sesión Zajuna es prioritaria y va primero a igual hora; dudas se comporta como sesión en vivo', () => {
  const now = { date: '2026-10-07', time: '18:30' };
  const z = ev({ event_id: 'z', type_label: 'SESION_ZAJUNA', event_date: '2026-10-08', start_time: '08:00', title: 'B' });
  const a = ev({ event_id: 'a', type_label: 'SESION_ADICIONAL', event_date: '2026-10-08', start_time: '08:00', title: 'A' });
  const d = ev({ event_id: 'd', type_label: 'DUDAS', event_date: '2026-10-07', start_time: '18:00', end_time: '19:00' });
  assert.equal(isPriority(z), true);
  assert.equal(isPriority(a), false);
  assert.deepEqual([kindOf(z), kindOf(a), kindOf(d)], ['SESION_ZAJUNA', 'SESION_ADICIONAL', 'DUDAS']);
  assert.deepEqual([kindName(z), kindName(a), kindName(d)], ['Sesión Zajuna', 'Sesión adicional', 'Dudas']);
  assert.deepEqual([a, z].sort(compareEvents).map((e) => e.event_id), ['z', 'a']);
  assert.equal(isLive(d, now), true, 'dudas está «En curso» dentro de su horario');
  assert.deepEqual(upcoming([a, z, d], now).map((e) => e.event_id), ['d', 'z', 'a']);
  assert.equal(kindOf(ev({ type_label: 'SESION' as CalendarEvent['type_label'] })), 'SESION_ZAJUNA', 'datos antiguos cuentan como Zajuna');
});

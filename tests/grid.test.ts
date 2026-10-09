/**
 * Pruebas del editor tipo Excel (/admin → «Editar en la plataforma»).
 * Ejecutar: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPaste, dropHeaderRow, emptyCells, eventToCells, isBlankRow, isMultiCellPaste,
  matrixToCells, nextWeekCopy, parseClipboard, sameCells, sortKey, type GridCells
} from '../src/lib/grid.ts';
import { checkGridRows } from '../src/lib/excel/check-grid.ts';

const cells = (p: Partial<GridCells>): GridCells => ({ ...emptyCells(), ...p });

test('evento publicado → fila del editor con los mismos formatos de la plantilla', () => {
  const c = eventToCells({
    event_id: 'EVT-0001', category: 'SESION', type_label: 'SESION_ZAJUNA', title: 'Matemáticas',
    event_date: '2026-10-05', start_time: '08:00', end_time: null, link: null, description: 'U3', instructor: 'Ana Pérez'
  });
  assert.deepEqual(c, {
    ID_EVENTO: 'EVT-0001', TIPO: 'SESION_ZAJUNA', NOMBRE: 'Matemáticas', FECHA: '05/10/2026',
    HORA_INICIO: '08:00', HORA_FIN: '', LINK: '', DESCRIPCION: 'U3', INSTRUCTOR: 'Ana Pérez'
  });
});

test('portapapeles de Excel: tabuladores, saltos de línea, comillas y salto final', () => {
  const text = 'CLASE\tMatemáticas\t05/10/2026\r\nTRABAJO\t"Taller ""2""\nparte b"\t06/10/2026\r\n';
  assert.deepEqual(parseClipboard(text), [
    ['CLASE', 'Matemáticas', '05/10/2026'],
    ['TRABAJO', 'Taller "2"\nparte b', '06/10/2026']
  ]);
  assert.equal(isMultiCellPaste('solo texto'), false);
  assert.equal(isMultiCellPaste('una celda copiada de Excel\r\n'), false);
  assert.equal(isMultiCellPaste('a\tb'), true);
  assert.equal(isMultiCellPaste('a\nb'), true);
});

test('pegar con encabezados: ubica cada columna por su nombre aunque cambie el orden', () => {
  const m = parseClipboard('Nombre\tTipo\tFecha\tHora inicio\nInglés\tclase\t07/10/2026\t14:00\n\t\t\t\n');
  const rows = matrixToCells(m);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], cells({ NOMBRE: 'Inglés', TIPO: 'SESION_ZAJUNA', FECHA: '07/10/2026', HORA_INICIO: '14:00' }));
});

test('pegar sin encabezados: 8 columnas empiezan en ID; menos empiezan en TIPO', () => {
  const full = matrixToCells([['EVT-9', 'ENTREGA', 'Taller', '06/10/2026', '23:59', '', '', 'PDF']]);
  assert.equal(full[0].ID_EVENTO, 'EVT-9');
  assert.equal(full[0].DESCRIPCION, 'PDF');
  const short = matrixToCells([['Sesión', 'Tutoría', '10/10/2026', '10:00', '12:00']]);
  assert.deepEqual(short[0], cells({ TIPO: 'SESION_ZAJUNA', NOMBRE: 'Tutoría', FECHA: '10/10/2026', HORA_INICIO: '10:00', HORA_FIN: '12:00' }));
});

test('pegar dentro de la tabla: escribe desde la celda elegida, agrega filas y protege los ID publicados', () => {
  const base = [
    cells({ ID_EVENTO: 'EVT-0001', TIPO: 'SESION_ZAJUNA', NOMBRE: 'A', FECHA: '01/10/2026', HORA_INICIO: '08:00' }),
    cells({})
  ];
  const isNew = (i: number) => i === 1;
  const res = applyPaste(base, 0, 0, [['EVT-X', 'trabajo', 'B'], ['EVT-Y', 'Entrega', 'C'], ['', 'CLASE', 'D']], isNew);
  assert.equal(res.added, 1);
  assert.equal(res.touched, 3);
  assert.equal(res.rows[0].ID_EVENTO, 'EVT-0001', 'el ID publicado no se sobrescribe');
  assert.equal(res.rows[0].TIPO, 'ENTREGA', 'el nombre antiguo TRABAJO se convierte al pegar');
  assert.equal(res.rows[1].ID_EVENTO, 'EVT-Y', 'en filas nuevas sí se puede pegar ID');
  assert.equal(res.rows[1].TIPO, 'ENTREGA');
  assert.equal(res.rows[2].NOMBRE, 'D');
  assert.equal(res.rows[2].TIPO, 'SESION_ZAJUNA', 'el nombre antiguo CLASE se convierte al pegar');
  assert.equal(base[0].TIPO, 'SESION_ZAJUNA', 'no modifica la tabla original');
  assert.deepEqual(dropHeaderRow([['ID_EVENTO', 'TIPO', 'NOMBRE'], ['', 'CLASE', 'X']]), [['', 'CLASE', 'X']]);
});

test('duplicar para la semana siguiente: sin ID y fecha + 7 días (cambia de mes bien)', () => {
  const copy = nextWeekCopy(cells({ ID_EVENTO: 'EVT-0003', TIPO: 'SESION_ZAJUNA', NOMBRE: 'Física', FECHA: '28/10/2026', HORA_INICIO: '18:00' }));
  assert.equal(copy.ID_EVENTO, '');
  assert.equal(copy.FECHA, '04/11/2026');
  assert.equal(copy.HORA_INICIO, '18:00');
});

test('ordenar por fecha y hora; filas sin fecha al final', () => {
  const list = [
    cells({ NOMBRE: 'sin fecha' }),
    cells({ FECHA: '06/10/2026', HORA_INICIO: '08:00' }),
    cells({ FECHA: '05/10/2026' }),
    cells({ FECHA: '05/10/2026', HORA_INICIO: '7:00 AM' })
  ].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : 1));
  assert.deepEqual(list.map((c) => c.NOMBRE || `${c.FECHA} ${c.HORA_INICIO}`), [
    '05/10/2026 7:00 AM', '05/10/2026 ', '06/10/2026 08:00', 'sin fecha'
  ]);
  assert.equal(isBlankRow(cells({ NOMBRE: '  ' })), true);
  assert.equal(sameCells(cells({ NOMBRE: 'A ' }), cells({ NOMBRE: 'A' })), true);
});

test('servidor: las filas del editor se validan igual que un Excel, numeradas como en la tabla', () => {
  const ok = checkGridRows([
    cells({ TIPO: 'SESION_ZAJUNA', NOMBRE: 'Matemáticas', FECHA: '05/10/2026', HORA_INICIO: '08:00', HORA_FIN: '10:00', LINK: 'https://meet.google.com/x' }),
    cells({}), // fila vacía: se ignora
    cells({ ID_EVENTO: 'EVT-0002', TIPO: 'ENTREGA', NOMBRE: 'Taller 2', FECHA: '06/10/2026' })
  ]);
  assert.equal(ok.ok, true);
  if (ok.ok) {
    assert.equal(ok.rows.length, 2);
    assert.equal(ok.rows[0].event_date, '2026-10-05');
    assert.equal(ok.fileName, 'Edición en la plataforma');
  }

  const bad = checkGridRows([
    cells({ TIPO: 'SESION_ZAJUNA', NOMBRE: 'A', FECHA: '05/10/2026', HORA_INICIO: '08:00' }),
    cells({ TIPO: 'SESION_ZAJUNA', NOMBRE: 'B', FECHA: '31/02/2026', HORA_INICIO: '08:00' }),
    cells({ TIPO: 'REUNION', NOMBRE: 'C', FECHA: '05/10/2026' })
  ]);
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.ok(bad.errors.some((e) => e.row === 2 && e.column === 'FECHA'));
    assert.ok(bad.errors.some((e) => e.row === 3 && e.column === 'TIPO'));
  }

  const empty = checkGridRows([cells({}), cells({})]);
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.match(empty.errors[0].message, /no tiene eventos/);

  assert.equal(checkGridRows('no es una lista').ok, false);
  assert.equal(checkGridRows([{ TIPO: 7, NOMBRE: null }]).ok, false, 'tolera datos con forma incorrecta sin romperse');
});

test('pegar sin encabezados con la columna INSTRUCTOR: se ubica igual (con o sin ID)', () => {
  const sinId = matrixToCells([['Sesión Zajuna', 'Física', '10/10/2026', '08:00', '10:00', '', '', 'Ana Pérez']]);
  assert.equal(sinId[0].TIPO, 'SESION_ZAJUNA');
  assert.equal(sinId[0].INSTRUCTOR, 'Ana Pérez');
  const conId = matrixToCells([['EVT-0007', 'SESION_ADICIONAL', 'Refuerzo', '11/10/2026', '14:00', '', '', '', 'Luis Gómez']]);
  assert.equal(conId[0].ID_EVENTO, 'EVT-0007');
  assert.equal(conId[0].INSTRUCTOR, 'Luis Gómez');
});

test('editor: el instructor viaja con la fila y se ignora en tipos que no son sesión', () => {
  const r = checkGridRows([
    cells({ TIPO: 'SESION_ZAJUNA', NOMBRE: 'Física', FECHA: '10/10/2026', HORA_INICIO: '08:00', INSTRUCTOR: ' Ana   Pérez ' }),
    cells({ TIPO: 'ENTREGA', NOMBRE: 'Taller', FECHA: '10/10/2026', INSTRUCTOR: 'Alguien' })
  ]);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.rows[0].instructor, 'Ana Pérez');
    assert.equal(r.rows[1].instructor, null);
    assert.ok(r.warnings.some((w) => w.row === 2 && w.column === 'INSTRUCTOR'));
  }
});

# Calendario Académico

Calendario público de sesiones, grabaciones y entregas, con panel administrativo que actualiza todo el calendario desde un archivo Excel.

- **Página pública** (`/`): calendario mensual que empieza en lunes, vista Agenda, panel con las 5 próximas actividades, detalle de cada evento y botón «Ingresar a la sesión». Sin inicio de sesión.
- **Panel administrativo** (`/admin`): inicio de sesión, indicadores y dos formas de actualizar el calendario:
  - **Editar en la plataforma**: tabla tipo Excel con las mismas columnas de la plantilla. Se editan celdas, se agregan, duplican (+7 días) o eliminan filas y se pegan bloques copiados de Excel o Google Sheets.
  - **Subir archivo Excel**: descarga del Excel actual o de la plantilla, carga con validación.
  Ambas pasan por vista previa de cambios, confirmación, resultado e historial con opción de deshacer.
- **Actualización segura**: el Excel (o la tabla del editor) es el calendario completo. Se valida todo antes de tocar la base de datos, se muestra qué se crea, actualiza y elimina, se guarda un respaldo y los cambios se aplican en una sola transacción: todo o nada.

**Stack:** Next.js 15 · React 19 · Supabase (Postgres, Auth, RLS, Storage) · Vercel · ExcelJS. Todo en planes gratuitos.

---

## Contenido

1. [Preparar los datos](#1-preparar-los-datos)
2. [Configurar Supabase](#2-configurar-supabase)
3. [Subir el código a GitHub](#3-subir-el-código-a-github)
4. [Publicar en Vercel](#4-publicar-en-vercel)
5. [Primera importación](#5-primera-importación)
6. [Lista de verificación](#6-lista-de-verificación)
7. [Uso diario](#7-uso-diario)
8. [Desarrollo local](#8-desarrollo-local-opcional)
9. [Solución de problemas](#9-solución-de-problemas)
10. [Arquitectura y seguridad](#10-arquitectura-y-seguridad)

---

## 1. Preparar los datos

Usa `public/plantilla-calendario.xlsx` (también se descarga desde `/admin` → «Descargar plantilla vacía»). La hoja «Instrucciones» del mismo archivo explica cada columna con ejemplos.

Para la **primera carga**, deja ID_EVENTO vacío en todas las filas: la app asigna `EVT-0001`, `EVT-0002`… Después de importar, descarga el «Excel actual» y úsalo como base para cualquier cambio.

| Columna | Obligatoria | Formato | Ejemplo |
|---|---|---|---|
| ID_EVENTO | No | Texto único. Vacío en filas nuevas: la app asigna `EVT-0001`… | EVT-0001 |
| TIPO | Sí | SESION_ZAJUNA, SESION_ADICIONAL, DUDAS, GRABACION, ENTREGA, CUESTIONARIO o FORO | SESION_ZAJUNA |
| NOMBRE | Sí | Texto, máx. 150 caracteres | Matemáticas II |
| FECHA | Sí | dd/mm/aaaa | 05/10/2026 |
| HORA_INICIO | Sesiones y dudas | hh:mm en 24 h. En grabaciones es la hora desde la que está disponible (opcional). En entregas, cuestionarios y foros es la hora límite; vacía = 11:59 PM | 08:00 |
| HORA_FIN | No | hh:mm, posterior al inicio | 10:00 |
| LINK | No | Empieza por https:// | https://meet.google.com/… |
| DESCRIPCION | No | Texto, máx. 2.000 caracteres | Traer calculadora |
| INSTRUCTOR | No | Texto, máx. 120 caracteres. SESION_ZAJUNA, SESION_ADICIONAL y GRABACION (la grabación lleva el instructor de la sesión; el mismo instructor puede repetirse el mismo día). En otros tipos se ignora con aviso. Si un Excel antiguo no trae esta columna, se conservan los instructores guardados | Ana Pérez |

Reglas:

- Una fila = un evento. Una sesión semanal se escribe una vez por fecha.
- El archivo es el calendario **completo**: borrar una fila elimina ese evento al importar.
- Para editar después, descarga siempre el **Excel actual** desde `/admin`. Trae los ID y evita duplicados.
- No cambies el nombre de la hoja «Calendario» ni los encabezados.

## 2. Configurar Supabase

Tiempo: unos 10 minutos.

### 2.1 Crear el proyecto

1. Entra a [supabase.com](https://supabase.com) → **New project**.
2. Nombre: `calendario-academico`. Escribe una contraseña de base de datos y guárdala.
3. Región: **East US (North Virginia)**, la misma zona donde Vercel ejecuta las funciones por defecto.
4. Plan: **Free** → **Create new project**. Espera a que termine de crearse.

### 2.2 Crear tablas, seguridad y funciones

1. Menú izquierdo → **SQL Editor** → **New query**.
2. Copia todo el contenido de `supabase/migrations/0001_init.sql`, pégalo y pulsa **Run**.
3. Debe aparecer «Success. No rows returned». Se puede ejecutar de nuevo sin dañar nada.

### 2.3 Cerrar el registro público

1. **Authentication** → **Sign In / Providers**.
2. Desactiva **Allow new users to sign up** y guarda. Deja activo el proveedor **Email**.

Así nadie puede crearse una cuenta; solo existen los usuarios que tú crees.

### 2.4 Crear tu usuario administrador

1. **Authentication** → **Users** → **Add user** → **Create new user**.
2. Escribe tu correo y una contraseña segura. Marca **Auto Confirm User** → **Create user**.
3. **SQL Editor** → **New query** → pega `supabase/crear_admin.sql`, cambia `tu-correo@ejemplo.com` por tu correo y pulsa **Run**. La consulta final debe mostrar tu correo.

### 2.5 Copiar los datos de conexión

Pulsa **Connect** (arriba en el proyecto) o ve a **Project Settings** → **API Keys** y copia:

- **Project URL** → será `NEXT_PUBLIC_SUPABASE_URL`
- **Publishable key** (`sb_publishable_…`) → será `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

> Nunca uses la **secret key** (`sb_secret_…`) ni la `service_role` en esta app. No las necesita.

## 3. Subir el código a GitHub

1. En [github.com](https://github.com) → **New repository** → nombre `calendario-academico` → **Private** → **Create repository**.
2. En la página del repositorio vacío, pulsa **uploading an existing file**.
3. Descomprime el zip y arrastra **el contenido** de la carpeta `calendario-academico` (no la carpeta misma). Incluye los archivos que empiezan por punto: `.gitignore` y `.env.example`. En Mac, muéstralos en Finder con `Cmd + Shift + .`.
4. **Commit changes**.

> No subas ningún archivo `.env.local`. El `.gitignore` ya lo excluye si usas Git.

## 4. Publicar en Vercel

1. En [vercel.com](https://vercel.com) → **Add New…** → **Project** → importa el repositorio `calendario-academico`. Si no aparece, pulsa **Adjust GitHub App Permissions** y dale acceso.
2. Vercel detecta **Next.js**. No cambies Build Command ni Output Directory.
3. Abre **Environment Variables** y agrega:

   | Nombre | Valor |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL del paso 2.5 |
   | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Publishable key del paso 2.5 |
   | `NEXT_PUBLIC_APP_NAME` | Nombre que verán los estudiantes, por ejemplo `Calendario Académico` |
   | `NEXT_PUBLIC_APP_SUBTITLE` | Opcional, por ejemplo `Grupo 3 · hora de Colombia` |
   | `CRON_SECRET` | Texto aleatorio de al menos 16 caracteres |

4. **Deploy**. En 1 a 3 minutos tendrás una URL como `https://calendario-academico.vercel.app`.
5. Vuelve a Supabase → **Authentication** → **URL Configuration** → **Site URL** = tu URL de Vercel → **Save**.

Desde ahora, cada cambio que subas a la rama `main` de GitHub se publica solo.

## 5. Primera importación

1. Abre `https://TU-URL.vercel.app/admin` e inicia sesión con el usuario del paso 2.4.
2. En «Actualizar calendario con Excel», arrastra tu plantilla llena.
3. **Validar archivo**. Si hay errores, la tabla indica fila, columna, valor y cómo corregirlo. Nada se modifica.
4. **Ver vista previa**: revisa cuántos eventos se crean, actualizan y eliminan.
5. **Confirmar actualización** → confirma de nuevo en la ventana.
6. Abre la página pública: el calendario ya muestra tus eventos.

## 6. Lista de verificación

- [ ] La página pública abre sin pedir inicio de sesión.
- [ ] El día de hoy aparece resaltado en amarillo y el mes empieza en lunes.
- [ ] Las fechas coinciden con el Excel (una clase del 5 de octubre aparece el 5).
- [ ] «Próximas actividades» muestra 5 elementos, del más cercano al más lejano.
- [ ] «Ingresar a la sesión» abre el enlace correcto.
- [ ] `/admin` sin sesión redirige al inicio de sesión.
- [ ] Un Excel con un error no cambia el calendario.
- [ ] El historial muestra la importación con tu correo.
- [ ] En el celular, el panel de próximas actividades aparece debajo del calendario.

## 7. Uso diario

**Opción A · Editar en la plataforma** (recomendada para cambios puntuales)

1. `/admin` → pestaña **Editar en la plataforma**. La tabla muestra todos los eventos publicados.
2. Edita celdas directamente. Las celdas cambiadas se marcan en azul y las filas nuevas en verde.
3. Para agregar: **+ Agregar fila**, **+7 días** en una fila (la duplica para la semana siguiente) o **Pegar desde Excel** (copia filas en Excel, con o sin encabezados, y pégalas). También puedes pegar un bloque directamente sobre una celda.
4. Para quitar un evento: **✕** en su fila. Si te equivocas, «recuperar filas eliminadas».
5. **Revisar y guardar**. Si hay errores, las celdas quedan en rojo con el motivo y nada se guarda. Si no, verás la vista previa.
6. **Confirmar cambios**. Se guarda un respaldo y se aplica todo en una sola operación.

Atajos: Enter baja a la fila siguiente (y crea una al final), Shift+Enter sube, flechas arriba/abajo se mueven entre filas. La búsqueda, el filtro **Tipo** (puedes marcar varios tipos a la vez; «Todos» los quita) y «Ocultar eventos pasados» solo cambian lo que ves; al guardar se usa la tabla completa.

**Opción B · Subir archivo Excel** (recomendada para cargas grandes)

1. `/admin` → pestaña **Subir archivo Excel** → **Descargar Excel actual**.
2. Edita: agrega filas (ID vacío), cambia datos o borra filas de eventos cancelados.
3. Súbelo, revisa la vista previa y confirma.

Si te equivocas, en **Historial de importaciones** pulsa **Deshacer** en esa actualización. La restauración también queda registrada y se puede deshacer.

## Recordatorio diario por WhatsApp (solo administrador)

Panel `/admin` → **Recordatorio por WhatsApp**. Usa la API gratuita de CallMeBot, que es **solo para uso personal**: envía mensajes únicamente al número que la autorizó. No sirve para avisar a estudiantes.

1. Guarda en tus contactos **+34 623 91 22 04** y envíale por WhatsApp: `I allow callmebot to send me messages`.
2. Copia la *apikey* que te responde en el panel, revisa tu número y la hora (por defecto 8:00 PM), marca «Enviarme el resumen todos los días» y pulsa **Guardar**.
3. Pulsa **Enviar prueba**.

Cómo funciona (`supabase/migrations/0002_whatsapp_recordatorios.sql`):

- `pg_cron` ejecuta `run_notifications()` cada 5 minutos: a la hora elegida arma el resumen de **mañana** (sesiones Zajuna, adicionales, dudas, entregas, cuestionarios y foros; sin grabaciones) y, además, envía un **aviso antes de cada sesión** (Zajuna, adicional o dudas; por defecto 2 horas antes, con el enlace). Todo se envía con la extensión `http` (`supabase/migrations/0003_recordatorio_antes_de_sesion.sql`).
- Cada aviso de sesión se envía una sola vez (si cambia la hora de la sesión, vuelve a avisar). Si CallMeBot falla, se reintenta máximo 3 veces.
- `send_today_digest()` envía el resumen de lo que queda de **hoy** (uso puntual, por ejemplo programado una vez con `cron.schedule`).
- Si mañana no hay actividades, no se envía nada. Nunca se envía dos veces para el mismo día.
- La clave se guarda cifrada en **Supabase Vault** (`callmebot_apikey`). Las tablas `notify_settings` y `notification_log` no son accesibles desde el navegador; solo las funciones `notify_*`, que verifican `is_admin()`.
- La bitácora (últimos envíos, errores de CallMeBot) se ve en el mismo panel. Máximo 5 pruebas por hora.

## 8. Desarrollo local (opcional)

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env.local   # y completa los valores
npm run dev                  # abre http://localhost:3000
npm run typecheck            # chequeo de tipos
npm test                     # pruebas de lectura de Excel, validación y reglas del calendario
npm run plantilla            # regenera public/plantilla-calendario.xlsx (requiere Python + openpyxl)
```

**Pruebas incluidas**

- `tests/grid.test.ts`: editor tipo Excel. Conversión de eventos a filas, pegado desde Excel (tabuladores, comillas, encabezados en cualquier orden, con o sin ID), protección de los ID publicados, duplicar +7 días, orden por fecha y validación de las filas del editor con las mismas reglas del Excel.
- `tests/excel.test.ts`: fechas de Excel sin desfase de un día, horas en 24 h y AM/PM, errores con fila y columna (fecha inexistente, ID repetido, tipo no válido, sesión sin hora, fin antes del inicio, enlace inválido), archivo vacío, duplicados, orden y límite de «Próximas actividades», estados de entregas.
- La migración SQL se probó en Postgres 16: permisos (no admin, público), vista previa = resultado, IDs automáticos, conflicto de versión, reversión completa si algo falla a mitad, «Deshacer» con vista previa, IDs duplicados y respaldo inexistente.

## 9. Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| La página pública dice «No se pudo cargar el calendario» | Variables de entorno mal copiadas o proyecto de Supabase pausado | Revisa las variables en Vercel → Settings → Environment Variables y vuelve a desplegar. En Supabase, si el proyecto dice «Paused», pulsa **Restore**. |
| «Correo o contraseña incorrectos» | Usuario sin confirmar o contraseña distinta | Supabase → Authentication → Users: verifica el usuario; si hace falta, bórralo y créalo con **Auto Confirm User**. |
| «Sin permisos de administrador» | El usuario no está en la tabla `admins` | Ejecuta `supabase/crear_admin.sql` con ese correo. |
| «El calendario cambió mientras revisabas la vista previa» | Se aplicó otra importación entre la vista previa y la confirmación | Pulsa **Volver a validar** y revisa la nueva vista previa. |
| «No se encontró la hoja Calendario» o «Faltan columnas» | Se renombró la hoja o los encabezados | Descarga la plantilla o el Excel actual y copia tus datos allí. |
| Una fecha aparece un día antes | Fecha escrita como texto en otro formato | Usa dd/mm/aaaa. La app interpreta las fechas sin zona horaria, así que en celdas de fecha de Excel no ocurre. |
| Los cambios no se ven en la página pública | Caché del navegador | Recarga la página. La app se regenera al confirmar cada importación y como máximo cada 5 minutos. |
| El despliegue falla en Vercel | Falta una variable o error de compilación | Vercel → Deployments → abre el despliegue fallido → **Build Logs** y revisa el primer error. |

## 10. Arquitectura y seguridad

```
src/
├── app/
│   ├── page.tsx                  Página pública (se regenera tras cada importación)
│   ├── admin/page.tsx            Panel administrativo
│   ├── admin/login/page.tsx      Inicio de sesión
│   ├── api/import/preview        Valida un Excel o las filas del editor y simula los cambios (no modifica nada)
│   ├── api/import/apply          Aplica la actualización (Excel o editor) en una transacción
│   ├── api/import/restore        Simula o aplica una restauración
│   ├── api/excel/template        Descarga la plantilla vacía
│   ├── api/excel/export          Descarga el Excel actual con ID
│   ├── api/events                JSON público de solo lectura (integraciones)
│   └── api/keepalive             Cron diario para que Supabase no pause el proyecto
├── components/                   Calendario, panel lateral, modales, panel admin
├── components/admin/GridEditor   Editor tipo Excel del panel
├── lib/grid.ts                   Lógica del editor: pegado desde Excel, +7 días, orden
├── lib/excel/                    Lectura, validación y generación de Excel (check-grid.ts valida el editor)
├── lib/dates.ts                  Fechas en hora de Colombia
├── lib/events.ts                 Reglas de próximas actividades y estados
└── middleware.ts                 Protege /admin
supabase/
├── migrations/0001_init.sql      Tablas, RLS, funciones, Storage
└── crear_admin.sql               Autoriza un administrador
public/plantilla-calendario.xlsx  Plantilla oficial vacía
scripts/generar_plantilla.py      Genera la plantilla
tests/                            Pruebas automáticas
```

**Seguridad**

- El público solo puede leer `events` y `calendar_state`. Ninguna tabla acepta escrituras desde la API.
- La única forma de escribir es `apply_calendar_import` / `restore_snapshot`, que verifican `is_admin()` dentro de la base de datos.
- La app no usa la clave secreta de Supabase; la clave publicable está limitada por RLS.
- Registro público desactivado; los administradores se autorizan en la tabla `admins`.

**Integridad de datos**

- Validación completa antes de tocar la base de datos, repetida en el servidor al confirmar. El editor web y el Excel usan exactamente las mismas reglas y la misma función SQL.
- La vista previa y la aplicación usan la misma función SQL, así que no pueden diferir.
- Control de versión: si otra importación se aplicó entre la vista previa y la confirmación, se rechaza.
- Transacción única: respaldo + eliminaciones + creaciones + actualizaciones + historial. Si algo falla, Postgres revierte todo.
- Respaldos: foto completa del calendario antes de cada cambio (se conservan los últimos 30) y el archivo Excel original en un bucket privado.
- Los ID automáticos nunca se reutilizan, aunque se elimine el evento.
- Solo se tocan eventos con `source = 'excel'`; usuarios, permisos y configuración no se ven afectados.

**Fechas**

Fechas y horas se guardan tal como vienen del Excel, en hora local de Colombia (UTC-5, sin horario de verano). Una columna `sort_at` guarda el instante real para ordenar. El navegador nunca convierte fechas con su propia zona horaria.

**Decisiones aprobadas**

- Entrega sin hora: vence a las 11:59 PM. Sesión: hora de inicio obligatoria.
- ID_EVENTO vacío: se asigna automáticamente.
- Tipos en vivo (hora de inicio obligatoria, hora de fin opcional, estado «En curso», aparecen en «Próximas actividades»): SESION_ZAJUNA (azul intenso, etiqueta «Prioritaria», va primero a igual hora), SESION_ADICIONAL (cian) — ambas con el ícono de cámara y botón «Ingresar a la sesión» — y DUDAS (ámbar, globo de chat con «?», espacio para resolver dudas por chat, botón «Ir al chat de dudas» cuando tenga enlace). GRABACION (rosa, ícono de pantalla con «play»): material disponible desde una fecha, hora opcional, botón «Ver grabación», no vence y no aparece en «Próximas actividades». SESION y CLASE son nombres antiguos: se siguen aceptando con aviso y se guardan como SESION_ZAJUNA. En Excel se puede escribir «Sesión Zajuna» o «sesion adicional»: se normaliza al nombre oficial. ENTREGA (rojo llamativo), CUESTIONARIO (verde, ícono de examen) y FORO (violeta) tienen fecha límite: la hora es la hora límite y sin hora vencen a las 11:59 PM, con estados Pendiente / Vence pronto / Vencido. Cuestionarios y foros pueden tener enlace, con botón «Presentar cuestionario» o «Ir al foro». Cada tipo tiene su filtro. ENTREGA es el nombre antiguo de CUESTIONARIO: se sigue aceptando en Excel y respaldos viejos y se guarda como CUESTIONARIO.
- Sesión sin enlace: advertencia, no error.
- Duplicados: si dos filas tienen el mismo tipo (sesión, dudas, grabación, entrega, cuestionario o foro), nombre, fecha y hora, es un error y no se guarda. El nombre se compara sin mayúsculas, tildes ni espacios repetidos. Aplica al editor web y al Excel.
- Instructor: columna opcional INSTRUCTOR para Sesiones Zajuna, adicionales y Grabaciones. Se muestra en «Próximas actividades», en el detalle de la sesión («Por confirmar» si está vacío), en la Agenda y en los mensajes de WhatsApp. Un evento sin instructor conserva su huella de contenido (no aparece como «modificado»).
- Orden dentro de un día: cuando las sesiones de ese día ya terminaron (días anteriores, o hoy después de la última sesión), las grabaciones ya disponibles suben al principio en el calendario, la agenda y el detalle del día.
- Sesión en curso: visible en «Próximas actividades» hasta su hora de fin (o 1 hora después del inicio si no tiene fin).
- Próximo a vencer: menos de 48 horas.
- El calendario es un componente propio que reproduce el diseño aprobado, en lugar de FullCalendar: menos dependencias y control total del diseño.

**Notas**

- `next.config.ts` no bloquea el despliegue por avisos de tipos (`ignoreBuildErrors`); usa `npm run typecheck` para revisarlos.
- Vercel Hobby es para uso no comercial. Si el calendario pasa a ser parte de un servicio pagado, el mismo código funciona en Netlify o Cloudflare Pages.

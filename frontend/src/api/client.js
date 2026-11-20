// Todo pasa por la ruta relativa /api — el dev server de Vite la redirige
// al backend de Fastify (ver server.proxy en vite.config.js). Sin estado
// propio ni comportamiento que valga la pena encapsular en una clase, así
// que queda como funciones simples.
//
// Todo pega contra el backend de verdad: ya no quedan datos de mentira.
//
// Cómo leer este archivo: cada función dice el endpoint (método + path +
// query/body), qué devuelve YA DESENVUELTO (el JSON tal cual, nunca
// { user } / { lesson }) y qué archivo del backend lo atiende. Los prefijos
// se registran en backend/src/app.js (/api/auth -> routes/auth, /api/classes
// -> routes/classes, etc.). Si el backend responde con error, la promesa se
// rechaza con un Error con `message` (en castellano, para mostrar), `status`,
// `code` y `fields` (ver request()).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// fetch NO manda cookies salvo que se le pida, y el backend guarda la sesión
// (`sid`) y el secreto del CSRF en cookies httpOnly. En dev no se nota porque
// el proxy de Vite hace que todo sea same-origin, pero en producción el front
// sale por el rewrite del sitio estático de Render y sin esto la sesión se pierde en cada pedido.
const CREDENTIALS = 'include'

// El backend exige un token CSRF (header x-csrf-token) en cualquier POST de
// auth. Se pide una sola vez y se cachea en memoria — si expira o el
// backend lo rechaza, request() reintenta una vez pidiendo uno nuevo.
let csrfTokenPromise = null

/**
 * GET /api/auth/csrf-token -> { csrfToken } (backend/src/routes/auth/index.js).
 * Devuelve el token (string), cacheado en csrfTokenPromise.
 */
function fetchCsrfToken() {
  if (!csrfTokenPromise) {
    csrfTokenPromise = fetch('/api/auth/csrf-token', {
      headers: { 'Content-Type': 'application/json' },
      credentials: CREDENTIALS,
    })
      .then((res) => res.json())
      .then((data) => data.csrfToken)
      .catch((err) => {
        csrfTokenPromise = null
        throw err
      })
  }
  return csrfTokenPromise
}

/**
 * El único lugar que llama a fetch para la API: agrega cookies, Content-Type
 * y el token CSRF, y convierte los errores del backend en excepciones.
 *
 * @param {string} path - '/api/...'.
 * @param {RequestInit} [options] - method, body (string JSON o FormData), headers.
 * @returns {Promise<any>} el JSON de la respuesta, o null si no tiene body (204).
 * @throws {Error} si no es 2xx: `message` (el del backend, o uno genérico),
 *   `status`, `code` (el `error` del backend) y `fields` (campo -> motivo).
 */
async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  // El Content-Type va SOLO si hay body: Fastify rechaza con 400 un
  // 'application/json' vacío, que es lo que manda un DELETE (o el logout).
  const headers = { ...options.headers }
  // Con FormData (subir archivos) el Content-Type lo arma el navegador, con
  // el boundary del multipart: si se fija acá, el backend no lo puede leer.
  if (options.body !== undefined && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json'
  }

  if (!SAFE_METHODS.has(method)) {
    headers['x-csrf-token'] = await fetchCsrfToken()
  }

  let response = await fetch(path, { ...options, method, headers, credentials: CREDENTIALS })

  if (response.status === 403 && !SAFE_METHODS.has(method)) {
    // Token vencido o inválido — se pide uno nuevo y se reintenta una vez.
    csrfTokenPromise = null
    headers['x-csrf-token'] = await fetchCsrfToken()
    response = await fetch(path, { ...options, method, headers, credentials: CREDENTIALS })
  }

  let data = null
  try {
    data = await response.json()
  } catch {
    // sin body (p. ej. error de red) — data queda en null
  }

  if (!response.ok) {
    const error = new Error(data?.message || 'Ocurrió un error inesperado.')
    error.status = response.status
    error.code = data?.error
    error.fields = data?.fields
    throw error
  }

  return data
}

/**
 * GET /api/subjects -> [{ id, name }], el catálogo fijo de materias por nombre.
 * Backend: routes/subjects/index.js. Público (no pide sesión).
 * Lo usan: components/SearchBar.jsx, pages/Booking/BookingBoard.jsx,
 * pages/Register/RegisterPage.jsx, pages/Profile/ProfilePage.jsx,
 * pages/Availability/TeacherAvailability.jsx.
 */
export function fetchSubjects() {
  return request('/api/subjects')
}

/**
 * POST /api/auth/register, body { email, password, role: 'teacher'|'student',
 * nombre, apellido, telefono?, subjectIds? (solo docentes) } -> 201 con el usuario público
 * (toPublicUser: { id, email, role, nombre, apellido, telefono,
 * approvalStatus, acceptsRewards, subjectIds, rates }); deja la sesión abierta.
 * Backend: routes/auth/index.js. Lo usa: pages/Register/RegisterPage.jsx.
 */
export function registerAccount(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * POST /api/auth/login, body { email, password } -> el usuario público (misma
 * forma que registerAccount) y la cookie de sesión.
 * Backend: routes/auth/index.js. Lo usa: pages/Login/LoginPage.jsx.
 */
export function loginAccount(credentials) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

/**
 * POST /api/auth/logout, sin body -> 204 (devuelve null). Borra la sesión.
 * Backend: routes/auth/index.js. Lo usa: App.jsx (handleLogout).
 */
export function logoutAccount() {
  return request('/api/auth/logout', { method: 'POST' })
}

/**
 * GET /api/auth/me -> el usuario de la sesión (misma forma que loginAccount);
 * 401 si no hay sesión. Backend: routes/auth/index.js.
 * Lo usa: App.jsx (al montar, para saber si hay sesión).
 */
export function fetchCurrentUser() {
  return request('/api/auth/me')
}

/**
 * Las clases del usuario logueado en ese rango: como docente las que da, como
 * alumno las que reservó. El backend filtra por la sesión, así que no hace
 * falta mandar quién es.
 *
 * GET /api/classes?from=YYYY-MM-DD&to=YYYY-MM-DD[&status=] -> [clase], cada una
 * con la forma de apiClass() en testing/fixtures.js (al alumno, `address` va
 * null hasta que paga: forViewer de backend/src/lib/classStates.js).
 * Backend: routes/classes/index.js.
 * Lo usan: pages/Calendar/CalendarPage.jsx, pages/Reservations/ReservationsPage.jsx.
 */
export function fetchClasses({ from, to, status }) {
  return request(
    `/api/classes?from=${from}&to=${to}${status ? `&status=${status}` : ''}`,
  )
}

/**
 * Los docentes con las materias que ofrecen ({ id, nombre, apellido,
 * subjects }), para las sugerencias del buscador.
 *
 * GET /api/teachers -> [{ id, nombre, apellido, subjects: [{ id, name }] }],
 * solo aprobados y con alguna tarifa. Backend: routes/teachers/index.js
 * (listTeachers de db/users.js). Lo usa: components/SearchBar.jsx.
 */
export function fetchTeachers() {
  return request('/api/teachers')
}

/**
 * Las ventanas del docente logueado que caen en el rango, SIN expandir: cada
 * una trae su fecha original y si se repite, que es lo que hace falta para
 * editarla. La pantalla las ubica en cada día de la semana que muestra.
 *
 * GET /api/teachers/me/availability?from&to -> [{ id, teacherId, date,
 * repeatsWeekly, start, end, modality, maxStudents, meetingUrl, locality,
 * address }]. Solo docentes. Backend: routes/teachers/index.js.
 * Lo usa: pages/Availability/TeacherAvailability.jsx.
 */
export function fetchMyWindows({ from, to }) {
  return request(`/api/teachers/me/availability?from=${from}&to=${to}`)
}

/**
 * POST /api/teachers/me/availability, body = draftToPayload() de utils/windows.js
 * -> 201 con la ventana guardada, con su id (misma forma que fetchMyWindows).
 * Backend: routes/teachers/index.js. Lo usa: pages/Availability/DayWindowsDialog.jsx.
 */
export function createWindow(window) {
  return request('/api/teachers/me/availability', {
    method: 'POST',
    body: JSON.stringify(window),
  })
}

/**
 * PUT /api/teachers/me/availability/:id, mismo body que createWindow -> la
 * ventana actualizada. Backend: routes/teachers/index.js.
 * Lo usa: pages/Availability/DayWindowsDialog.jsx.
 */
export function updateWindow(id, window) {
  return request(`/api/teachers/me/availability/${id}`, {
    method: 'PUT',
    body: JSON.stringify(window),
  })
}

/**
 * DELETE /api/teachers/me/availability/:id -> 204 (null). Las clases ya
 * reservadas en ella siguen. Backend: routes/teachers/index.js.
 * Lo usa: pages/Availability/DayWindowsDialog.jsx.
 */
export function deleteWindow(id) {
  return request(`/api/teachers/me/availability/${id}`, { method: 'DELETE' })
}

/**
 * La disponibilidad YA con fecha y YA neta de lo reservado: una fila por
 * (ventana, fecha), con su modalidad, cupo, las materias que se pueden
 * reservar con su tarifa (`subjects`), los tramos libres (`free`) y las
 * grupales a las que sumarse (`groups`). La pantalla del alumno nunca ve una
 * ventana semanal — el backend la proyecta sobre el rango pedido.
 *
 * `excludeClassId` es la clase propia que se está reprogramando: el backend
 * no la cuenta como ocupada, así se la puede correr media hora dentro del
 * mismo rato del docente.
 *
 * GET /api/availability?from&to[&excludeClassId] -> [{ id, windowId, date,
 * dayKey, teacherId, teacherName, teacherAcceptsRewards, teacherFeatured,
 * start, end, modality, maxStudents, locality, subjects, free, groups,
 * onVacation }], sin las ventanas del propio usuario. Nunca trae el link ni
 * la dirección exacta. Backend: routes/availability/index.js (filas armadas
 * por expandAvailability de lib/availabilityExpansion.js).
 * Lo usa: pages/Booking/BookingBoard.jsx.
 */
export function fetchAvailability({ from, to, excludeClassId = null }) {
  const params = new URLSearchParams({ from, to })
  if (excludeClassId) params.set('excludeClassId', excludeClassId)
  return request(`/api/availability?${params}`)
}

/**
 * Las clases que ya reservó el alumno logueado y siguen en pie, para pintar
 * en gris los horarios que le chocan. Todo lo que no está cancelado ocupa el
 * horario (pendiente incluida), y eso ya no se pide con un solo ?status: se
 * traen todas y se filtra acá.
 *
 * GET /api/classes?from&to -> [clase] sin las canceladas (misma forma que
 * fetchClasses). Backend: routes/classes/index.js.
 * Lo usa: pages/Booking/BookingBoard.jsx (para annotateClashes de utils/booking.js).
 */
export function fetchMyLessons({ from, to }) {
  return request(`/api/classes?from=${from}&to=${to}`).then((lessons) =>
    lessons.filter((lesson) => lesson.status !== 'cancelada'),
  )
}

/**
 * Una clase propia (como alumno o como docente), con su estado.
 * GET /api/classes/:id -> la clase (forma de fetchClasses); 404 si no es propia.
 * Backend: routes/classes/index.js.
 * Lo usa: pages/Booking/BookingBoard.jsx (la clase de ?reprogramar=<id>).
 */
export function fetchClass(id) {
  return request(`/api/classes/${id}`)
}

// Las acciones sobre una reserva. Todas devuelven la clase ya actualizada; si
// no se puede (la regla de 24 h, ya empezó, el otro la canceló), el backend
// dice por qué en el message del error.
// Backend: routes/classes/index.js; las reglas, checkAction de
// backend/src/lib/classStates.js (espejadas en utils/classStates.js).

/**
 * POST /api/classes/:id/accept, sin body -> la clase actualizada (aceptada, o
 * confirmada si un paquete/canje la cubre entera). Solo el docente.
 * Lo usan: components/ClassActions.jsx, components/StudentsDialog.jsx.
 */
export function acceptLesson(id) {
  return request(`/api/classes/${id}/accept`, { method: 'POST' })
}

/**
 * POST /api/classes/:id/cancel, sin body -> la clase cancelada (con cancelReason).
 * Lo usan: components/ClassActions.jsx, components/StudentsDialog.jsx.
 */
export function cancelLesson(id) {
  return request(`/api/classes/${id}/cancel`, { method: 'POST' })
}

/**
 * Aceptar o cancelar la clase entera (en una grupal, todas las reservas del
 * turno), todo o nada. Devuelve la lista de reservas actualizadas.
 *
 * POST /api/classes/:id/turn/accept y /turn/cancel, sin body -> [clase]; 409
 * si alguna cambió en el medio, 403 si no es el docente.
 * Lo usa: components/TurnActions.jsx.
 */
export function acceptTurn(id) {
  return request(`/api/classes/${id}/turn/accept`, { method: 'POST' })
}

export function cancelTurn(id) {
  return request(`/api/classes/${id}/turn/cancel`, { method: 'POST' })
}

/**
 * POST /api/classes/:id/pay, sin body -> la clase con `paidAt` (y confirmada
 * si estaba aceptada). No se cobra nada de verdad. Solo el alumno.
 * Lo usa: components/ClassActions.jsx.
 */
export function payLesson(id) {
  return request(`/api/classes/${id}/pay`, { method: 'POST' })
}

/**
 * POST /api/classes/:id/attendance, body { attended: boolean } -> la clase
 * realizada (true) o no_presentada (false). Solo el docente, con la clase empezada.
 * Lo usan: components/AttendanceDialog.jsx, components/ClassActions.jsx.
 */
export function markAttendance(id, attended) {
  return request(`/api/classes/${id}/attendance`, {
    method: 'POST',
    body: JSON.stringify({ attended }),
  })
}

// El material de una clase ya dada (resumen + archivos). Es del turno: en
// una grupal, cualquier reserva lleva al mismo. Todas devuelven el material
// entero, { summary, updatedAt, files: [{ id, name, mimeType, sizeBytes }] }.
// Backend: routes/classes/index.js (findMaterial de db/classMaterials.js; los
// archivos van al bucket por backend/src/storage/files.js).
// Lo usa: components/ClassMaterial.jsx.

/** GET /api/classes/:id/material -> el material del turno. */
export function fetchClassMaterial(id) {
  return request(`/api/classes/${id}/material`)
}

/** PUT /api/classes/:id/material, body { summary } -> el material. Solo el docente. */
export function saveClassSummary(id, summary) {
  return request(`/api/classes/${id}/material`, {
    method: 'PUT',
    body: JSON.stringify({ summary }),
  })
}

/**
 * POST /api/classes/:id/material/files, multipart con un campo `files` por
 * archivo -> 201 con el material. Solo el docente.
 */
export function uploadClassFiles(id, files) {
  const body = new FormData()
  for (const file of files) body.append('files', file, file.name)
  return request(`/api/classes/${id}/material/files`, { method: 'POST', body })
}

/** DELETE /api/classes/:id/material/files/:fileId -> el material sin ese archivo. */
export function deleteClassFile(id, fileId) {
  return request(`/api/classes/${id}/material/files/${fileId}`, { method: 'DELETE' })
}

/**
 * La URL de un archivo, para un link de descarga o un <img>: viaja con la cookie de sesión.
 * No hace pedido: GET a esa URL responde un 302 a un link firmado del bucket (5 min).
 */
export function classFileUrl(id, fileId) {
  return `/api/classes/${encodeURIComponent(id)}/material/files/${encodeURIComponent(fileId)}`
}

/**
 * Reprogramar: mismo body que reservar, sin materia (es la de la clase
 * vieja). Devuelve la reserva nueva, que nace pendiente. Puede usar clases
 * de un paquete igual que una reserva (las de la vieja se liberan).
 *
 * POST /api/classes/:id/reschedule, body { windowId, date, startTime,
 * durationMinutes, packId, packTokens, rewardType } -> 201 con la clase nueva
 * (pendiente, con rescheduledFrom). Solo el alumno, clase confirmada, ≥24 h antes.
 * Backend: routes/classes/index.js. Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function rescheduleLesson(
  id,
  { windowId, date, startTime, durationMinutes, packId, packTokens, rewardType },
) {
  return request(`/api/classes/${id}/reschedule`, {
    method: 'POST',
    body: JSON.stringify({ windowId, date, startTime, durationMinutes, packId, packTokens, rewardType }),
  })
}

/**
 * Reservar una clase en una ventana: qué día, a qué hora, de qué materia y
 * cuántos minutos. La modalidad sale de la ventana y el precio lo calcula el
 * backend con la tarifa del docente. Si a esa hora ya hay una grupal de la
 * misma materia y duración, es sumarse a ella. Devuelve la clase guardada,
 * sin envolver.
 *
 * `packId` + `packTokens` usan esa cantidad de clases de un paquete del
 * alumno con ese docente: lo que cubren no se paga, lo que se pasa sí. Cuando
 * el docente marca la asistencia, se descuentan del paquete.
 *
 * `rewardType` canjea neuronas en esta clase, si el docente acepta canjes. No se
 * combina con un paquete.
 *
 * POST /api/classes, body { windowId, date, startTime, subjectId,
 * durationMinutes, packId, packTokens, rewardType } -> 201 con la clase
 * (forma de fetchClasses). Solo alumnos. Backend: routes/classes/index.js
 * (validateBooking + insertClass de db/classes.js).
 * Lo usa: pages/Booking/BookingDialog.jsx.
 */
export function bookLesson({
  windowId,
  date,
  startTime,
  subjectId,
  durationMinutes,
  packId,
  packTokens,
  rewardType,
}) {
  return request('/api/classes', {
    method: 'POST',
    body: JSON.stringify({
      windowId,
      date,
      startTime,
      subjectId,
      durationMinutes,
      packId,
      packTokens,
      rewardType,
    }),
  })
}

/**
 * Guarda el perfil. Devuelve el usuario completo y actualizado (no envuelto
 * en { user }), igual que login y /me. El id sale de la sesión en el backend,
 * así que mandarlo en el body no cambiaría nada.
 *
 * `rates` es la lista ENTERA de tarifas del docente,
 * [{ subjectId, modality, hourlyRateCents }], y reemplaza a la que había.
 *
 * PATCH /api/users/me, body { telefono, subjectIds, rates } -> el usuario
 * público (forma de loginAccount). Un docente rechazado vuelve a pendiente.
 * Backend: routes/users/index.js. Lo usa: pages/Profile/ProfilePage.jsx.
 */
export function updateProfile(payload) {
  return request('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify({
      telefono: payload.telefono,
      subjectIds: payload.subjectIds,
      rates: payload.rates,
    }),
  })
}

// --- Administración -----------------------------------------------------------

/**
 * Los docentes para revisar, opcionalmente de un solo estado ('pending' |
 * 'approved' | 'rejected'). Solo para admins: a cualquier otro el backend le
 * contesta 403.
 *
 * GET /api/admin/teachers[?status=] -> [{ id, email, nombre, apellido,
 * telefono, approvalStatus, ... }] (listTeachersForReview de db/approvals.js).
 * Backend: routes/admin/index.js. Lo usa: pages/Admin/AdminPage.jsx.
 */
export function fetchTeachersForReview(status) {
  return request(`/api/admin/teachers${status ? `?status=${status}` : ''}`)
}

/**
 * Devuelve el docente ya actualizado.
 * POST /api/admin/teachers/:id/approve (y /reject abajo), sin body -> el docente
 * con la forma de fetchTeachersForReview. Backend: routes/admin/index.js.
 * Lo usa: pages/Admin/AdminPage.jsx.
 */
export function approveTeacher(id) {
  return request(`/api/admin/teachers/${id}/approve`, { method: 'POST' })
}

export function rejectTeacher(id) {
  return request(`/api/admin/teachers/${id}/reject`, { method: 'POST' })
}

// --- Paquetes de clases ---------------------------------------------------------

// Todas las usa pages/Packs/PacksPage.jsx (fetchMyPacks también BookingBoard).

/**
 * Los paquetes que ofrece el docente logueado.
 * GET /api/teachers/me/packs -> [{ id, teacherId, classCount, classMinutes,
 * priceCents, validityDays, createdAt }] (solo los activos).
 * Backend: routes/teachers/index.js.
 */
export function fetchMyPackOffers() {
  return request('/api/teachers/me/packs')
}

/**
 * { classCount, classMinutes, priceCents, validityDays }. Devuelve el paquete creado.
 * POST /api/teachers/me/packs -> 201. Backend: routes/teachers/index.js
 * (valida validatePackOffer de lib/classPacks.js).
 */
export function createPackOffer(offer) {
  return request('/api/teachers/me/packs', {
    method: 'POST',
    body: JSON.stringify(offer),
  })
}

/**
 * Dejar de ofrecerlo: quien ya lo compró lo sigue usando.
 * DELETE /api/teachers/me/packs/:id -> 204 (null). Backend: routes/teachers/index.js.
 */
export function deletePackOffer(id) {
  return request(`/api/teachers/me/packs/${id}`, { method: 'DELETE' })
}

/**
 * Los paquetes que se pueden comprar, opcionalmente de un docente.
 * GET /api/packs[?teacherId] -> [{ ...oferta, teacherName }], solo de docentes
 * aprobados. Backend: routes/packs/index.js.
 */
export function fetchPackOffers(teacherId) {
  return request(`/api/packs${teacherId ? `?teacherId=${teacherId}` : ''}`)
}

/**
 * Los paquetes que compró el alumno logueado, cada uno con su duración por
 * clase (`classMinutes`), `remaining` (las clases que le quedan: cada
 * asistencia descuenta las que usó), `available` (las que todavía puede
 * reservar) y `expired`.
 *
 * GET /api/packs/mine -> [{ id, packId, teacherId, teacherName, classCount,
 * classMinutes, priceCents, purchasedAt, expiresOn, ...StudentPack.summary }]
 * (remaining/available/expired los calcula StudentPack de lib/classPacks.js).
 * Backend: routes/packs/index.js.
 * Lo usan: pages/Packs/PacksPage.jsx, pages/Booking/BookingBoard.jsx.
 */
export function fetchMyPacks() {
  return request('/api/packs/mine')
}

/**
 * Nada se cobra de verdad: queda registrado. Devuelve el paquete comprado.
 * POST /api/packs/:id/buy, sin body -> 201 con la forma de fetchMyPacks.
 * Solo alumnos. Backend: routes/packs/index.js.
 */
export function buyPack(id) {
  return request(`/api/packs/${id}/buy`, { method: 'POST' })
}

// --- Vacaciones del docente -----------------------------------------------------

// En pantalla se llaman "Licencia". Backend: routes/teachers/index.js (reglas
// en lib/vacations.js). VacationsDialog.jsx crea/borra; TeacherAvailability
// las lista.

/**
 * Las vacaciones del docente logueado que todavía no terminaron.
 * GET /api/teachers/me/vacations -> [{ id, teacherId, startDate, endDate }].
 * Lo usa: pages/Availability/TeacherAvailability.jsx.
 */
export function fetchMyVacations() {
  return request('/api/teachers/me/vacations')
}

/**
 * Cuántas reservas se cancelarían con esas vacaciones: { cancelledClasses }.
 * GET /api/teachers/me/vacations/impact?startDate&endDate.
 * Lo usa: pages/Availability/VacationsDialog.jsx.
 */
export function fetchVacationImpact({ startDate, endDate }) {
  return request(`/api/teachers/me/vacations/impact?startDate=${startDate}&endDate=${endDate}`)
}

/**
 * { startDate, endDate } (los dos incluidos). Devuelve las vacaciones
 * guardadas con `cancelledClasses`: cuántas reservas de esos días se
 * cancelaron.
 *
 * POST /api/teachers/me/vacations -> 201 { id, teacherId, startDate, endDate,
 * cancelledClasses }. Lo usa: pages/Availability/VacationsDialog.jsx.
 */
export function createVacation({ startDate, endDate }) {
  return request('/api/teachers/me/vacations', {
    method: 'POST',
    body: JSON.stringify({ startDate, endDate }),
  })
}

/**
 * Borrar un rango cargado por error. Las reservas canceladas no vuelven.
 * DELETE /api/teachers/me/vacations/:id -> 204 (null).
 * Lo usa: pages/Availability/VacationsDialog.jsx.
 */
export function deleteVacation(id) {
  return request(`/api/teachers/me/vacations/${id}`, { method: 'DELETE' })
}

// --- Direcciones guardadas del docente --------------------------------------------

// Backend: routes/teachers/index.js (reglas en lib/addresses.js). Cada
// dirección: { id, label, saved, isDefault, street, number, postalCode,
// locality, city, floor, apartment, notes }.

/**
 * Las guardadas, la predeterminada primero.
 * GET /api/teachers/me/addresses -> [dirección].
 * Lo usan: pages/Profile/AddressesSection.jsx, pages/Availability/TeacherAvailability.jsx.
 */
export function fetchMyAddresses() {
  return request('/api/teachers/me/addresses')
}

/**
 * { label, street, number, postalCode, locality, city, floor, apartment, notes, isDefault }.
 * POST /api/teachers/me/addresses -> 201 con la dirección creada.
 * Lo usa: pages/Profile/AddressDialog.jsx.
 */
export function createAddress(address) {
  return request('/api/teachers/me/addresses', {
    method: 'POST',
    body: JSON.stringify(address),
  })
}

/**
 * Las ventanas que la usan cambian con ella; las clases ya reservadas no.
 * PUT /api/teachers/me/addresses/:id, mismo body que createAddress -> la dirección.
 * Lo usa: pages/Profile/AddressDialog.jsx.
 */
export function updateAddress(id, address) {
  return request(`/api/teachers/me/addresses/${id}`, {
    method: 'PUT',
    body: JSON.stringify(address),
  })
}

/**
 * POST /api/teachers/me/addresses/:id/default, sin body -> la dirección, ahora
 * predeterminada. Lo usa: pages/Profile/AddressesSection.jsx.
 */
export function setDefaultAddress(id) {
  return request(`/api/teachers/me/addresses/${id}/default`, { method: 'POST' })
}

/**
 * 409 con el motivo si la usa alguna ventana.
 * DELETE /api/teachers/me/addresses/:id -> 204 (null).
 * Lo usa: pages/Profile/AddressesSection.jsx.
 */
export function deleteAddress(id) {
  return request(`/api/teachers/me/addresses/${id}`, { method: 'DELETE' })
}

// --- Tareas ---------------------------------------------------------------------

/**
 * Las tareas del usuario logueado. El docente las recibe con `submissions`,
 * una por alumno; el alumno, con `submission`, solo la suya.
 *
 * GET /api/homework -> [{ id, title, description, dueDate, dueTime, classDate,
 * classStartTime, subjectName, teacherName, createdAt, submissions | submission }].
 * Backend: routes/homework/index.js (todas las de esta sección; reglas en
 * lib/homework.js). Lo usa: pages/Homework/HomeworkPage.jsx.
 */
export function fetchHomeworks() {
  return request('/api/homework')
}

/**
 * A quién puede asignar el docente: { students, groups }.
 * GET /api/homework/targets -> { students: [{ id, name }], groups: [{ classId,
 * date, startTime, subjectName, enrolled }] } (grupales de los últimos 60 días).
 * Lo usa: pages/Homework/NewHomeworkDialog.jsx.
 */
export function fetchHomeworkTargets() {
  return request('/api/homework/targets')
}

/**
 * { title, description, dueDate, dueTime } y `studentId` o `classId`. Devuelve la tarea.
 * POST /api/homework -> 201 con la tarea del docente (con `submissions`).
 * Lo usa: pages/Homework/NewHomeworkDialog.jsx.
 */
export function createHomework(homework) {
  return request('/api/homework', {
    method: 'POST',
    body: JSON.stringify(homework),
  })
}

/**
 * Entregar o cambiar la entrega. Devuelve la tarea actualizada.
 * PUT /api/homework/:id/submission (id de la TAREA), body { text, linkUrl } ->
 * la tarea del alumno (con `submission`). Lo usa: pages/Homework/StudentHomeworkDialog.jsx.
 */
export function submitHomework(id, { text, linkUrl }) {
  return request(`/api/homework/${id}/submission`, {
    method: 'PUT',
    body: JSON.stringify({ text, linkUrl }),
  })
}

/**
 * Corregir una entrega. Devuelve la tarea actualizada, con todas sus entregas.
 * POST /api/homework/submissions/:id/feedback (id de la ENTREGA), body { feedback }.
 * Lo usa: pages/Homework/TeacherSubmissionDialog.jsx.
 */
export function saveHomeworkFeedback(submissionId, feedback) {
  return request(`/api/homework/submissions/${submissionId}/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedback }),
  })
}

/**
 * El chat de una entrega. GET /api/homework/submissions/:id/messages ->
 * [{ id, senderId, senderName, senderRole, body, createdAt }].
 * Lo usa: pages/Homework/HomeworkChat.jsx (cada 5 s mientras está abierto).
 */
export function fetchHomeworkMessages(submissionId) {
  return request(`/api/homework/submissions/${submissionId}/messages`)
}

/**
 * POST /api/homework/submissions/:id/messages, body { body } -> 201 con el
 * mensaje creado (forma de fetchHomeworkMessages). Lo usa: pages/Homework/HomeworkChat.jsx.
 */
export function sendHomeworkMessage(submissionId, body) {
  return request(`/api/homework/submissions/${submissionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  })
}

// --- Neuronas -------------------------------------------------------------------

/**
 * Saldo, nivel e historial del usuario logueado. El alumno recibe además
 * `badges`, y el docente `featured`: lo decide el rol de la sesión.
 *
 * GET /api/neuronas -> { balance, earned, level: { name, min, nextName,
 * nextMin }, movements, badges | featured: { activeUntil, slotsLeft, cost, days } }.
 * Backend: routes/neuronas/index.js (reglas en lib/neuronas.js).
 * Lo usan: pages/Neuronas/NeuronasPage.jsx, pages/Booking/BookingBoard.jsx (saldo para canjes).
 */
export function fetchNeuronas() {
  return request('/api/neuronas')
}

/**
 * Compra 7 días de Destacado. Devuelve { endDate }.
 * POST /api/neuronas/featured, sin body -> 201; 409 si no alcanza o no hay lugar.
 * Backend: routes/neuronas/index.js. Lo usa: pages/Neuronas/NeuronasPage.jsx.
 */
export function buyFeatured() {
  return request('/api/neuronas/featured', { method: 'POST' })
}

/**
 * Si el docente acepta canjes de neuronas. Devuelve { acceptsRewards }.
 * PUT /api/teachers/me/accepts-rewards, body { accepts: boolean }. Va aparte de
 * updateProfile porque guardar el perfil devuelve a pendiente a un rechazado.
 * Backend: routes/teachers/index.js. Lo usa: pages/Profile/NeuronasSetting.jsx.
 */
export function setAcceptsRewards(accepts) {
  return request('/api/teachers/me/accepts-rewards', {
    method: 'PUT',
    body: JSON.stringify({ accepts }),
  })
}

// --- Docentes favoritos del alumno ------------------------------------------------
// Backend: routes/favorites/index.js (solo alumnos; a otro rol, 403).

/**
 * Los docentes favoritos del alumno logueado, con las materias que ofrecen
 * ({ id, nombre, apellido, subjects }). Solo los aprobados: si a uno lo dan
 * de baja, el favorito queda guardado pero no viene hasta que lo aprueben.
 *
 * GET /api/favorites -> [{ id, nombre, apellido, subjects: [{ id, name }] }].
 * Lo usan: pages/Favorites/FavoritesPage.jsx, routes/withFavorites.jsx.
 */
export function fetchFavoriteTeachers() {
  return request('/api/favorites')
}

/**
 * Idempotente: marcarlo dos veces no hace nada. Sin body (204).
 * PUT /api/favorites/:teacherId -> null; 404 si no es un docente aprobado.
 * Lo usa: components/FavoriteButton.jsx.
 */
export function addFavoriteTeacher(teacherId) {
  return request(`/api/favorites/${teacherId}`, { method: 'PUT' })
}

/**
 * Idempotente: sacar uno que no estaba no hace nada. Sin body (204).
 * DELETE /api/favorites/:teacherId -> null. Lo usa: components/FavoriteButton.jsx.
 */
export function removeFavoriteTeacher(teacherId) {
  return request(`/api/favorites/${teacherId}`, { method: 'DELETE' })
}

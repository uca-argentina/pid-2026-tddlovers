// Todo pasa por la ruta relativa /api — el dev server de Vite la redirige
// al backend de Fastify (ver server.proxy en vite.config.js). Sin estado
// propio ni comportamiento que valga la pena encapsular en una clase, así
// que queda como funciones simples.
//
// Todo pega contra el backend de verdad: ya no quedan datos de mentira.

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

// fetch NO manda cookies salvo que se le pida, y el backend guarda la sesión
// (`sid`) y el secreto del CSRF en cookies httpOnly. En dev no se nota porque
// el proxy de Vite hace que todo sea same-origin, pero en producción el front
// sale por nginx/Caddy y sin esto la sesión se pierde en cada pedido.
const CREDENTIALS = 'include'

// El backend exige un token CSRF (header x-csrf-token) en cualquier POST de
// auth. Se pide una sola vez y se cachea en memoria — si expira o el
// backend lo rechaza, request() reintenta una vez pidiendo uno nuevo.
let csrfTokenPromise = null

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

async function request(path, options = {}) {
  const method = (options.method || 'GET').toUpperCase()
  // El Content-Type va SOLO si hay body: Fastify rechaza con 400 un
  // 'application/json' vacío, que es lo que manda un DELETE (o el logout).
  const headers = { ...options.headers }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json'

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

export function fetchSubjects() {
  return request('/api/subjects')
}

export function checkEmailAvailability(email) {
  return request(`/api/auth/check-email?email=${encodeURIComponent(email)}`)
}

export function registerAccount(payload) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

export function loginAccount(credentials) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(credentials),
  })
}

export function logoutAccount() {
  return request('/api/auth/logout', { method: 'POST' })
}

export function fetchCurrentUser() {
  return request('/api/auth/me')
}

/**
 * Las clases del usuario logueado en ese rango: como docente las que da, como
 * alumno las que reservó. El backend filtra por la sesión, así que no hace
 * falta mandar quién es.
 */
export function fetchClasses({ from, to, status }) {
  return request(
    `/api/classes?from=${from}&to=${to}${status ? `&status=${status}` : ''}`,
  )
}

/**
 * Los docentes con las materias que ofrecen ({ id, nombre, apellido,
 * subjects }), para las sugerencias del buscador.
 */
export function fetchTeachers() {
  return request('/api/teachers')
}

/**
 * Las ventanas del docente logueado que caen en el rango, SIN expandir: cada
 * una trae su fecha original y si se repite, que es lo que hace falta para
 * editarla. La pantalla las ubica en cada día de la semana que muestra.
 */
export function fetchMyWindows({ from, to }) {
  return request(`/api/teachers/me/availability?from=${from}&to=${to}`)
}

/** Devuelve la ventana guardada, con su id. */
export function createWindow(window) {
  return request('/api/teachers/me/availability', {
    method: 'POST',
    body: JSON.stringify(window),
  })
}

export function updateWindow(id, window) {
  return request(`/api/teachers/me/availability/${id}`, {
    method: 'PUT',
    body: JSON.stringify(window),
  })
}

export function deleteWindow(id) {
  return request(`/api/teachers/me/availability/${id}`, { method: 'DELETE' })
}

/**
 * La disponibilidad YA con fecha y YA neta de lo reservado: una fila por
 * (ventana, fecha), con su modalidad, cupo, las materias que se pueden
 * reservar con su tarifa (`subjects`), los tramos libres (`free`) y las
 * grupales a las que sumarse (`groups`). La pantalla del alumno nunca ve una
 * ventana semanal — el backend la proyecta sobre el rango pedido.
 */
export function fetchAvailability({ from, to }) {
  return request(`/api/availability?from=${from}&to=${to}`)
}

/**
 * Las clases que ya reservó el alumno logueado, para pintar en gris los
 * horarios que le chocan. Es el mismo endpoint que fetchClasses: el backend
 * ya filtra por la sesión.
 */
export function fetchMyLessons({ from, to }) {
  return request(`/api/classes?from=${from}&to=${to}&status=reservada`)
}

/**
 * Reservar una clase en una ventana: qué día, a qué hora, de qué materia y
 * cuántos minutos. La modalidad sale de la ventana y el precio lo calcula el
 * backend con la tarifa del docente. Si a esa hora ya hay una grupal de la
 * misma materia y duración, es sumarse a ella. Devuelve la clase guardada,
 * sin envolver.
 */
export function bookLesson({ windowId, date, startTime, subjectId, durationMinutes }) {
  return request('/api/classes', {
    method: 'POST',
    body: JSON.stringify({ windowId, date, startTime, subjectId, durationMinutes }),
  })
}

/**
 * Guarda el perfil. Devuelve el usuario completo y actualizado (no envuelto
 * en { user }), igual que login y /me. El id sale de la sesión en el backend,
 * así que mandarlo en el body no cambiaría nada.
 *
 * `rates` es la lista ENTERA de tarifas del docente,
 * [{ subjectId, modality, hourlyRateCents }], y reemplaza a la que había.
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

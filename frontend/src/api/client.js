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
  const headers = { 'Content-Type': 'application/json', ...options.headers }

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
 * Un solo pedido con TODAS las materias de ESE docente, no una por materia.
 * La pantalla necesita las otras sí o sí —son las que bloquean horarios,
 * porque nadie puede dar dos clases a la vez— y pedirlas de a una sería un
 * N+1 con N estados de carga y una carrera entre promesas cada vez que se
 * cambia de materia.
 */
export function fetchAvailabilityByTeacher(teacherId) {
  return request(`/api/teachers/${teacherId}/availability`)
}

/**
 * La disponibilidad YA con fecha y YA neta de lo reservado: una fila por
 * (docente, materia, fecha). La pantalla del alumno nunca ve una plantilla
 * semanal — el backend proyecta la semana sobre el rango pedido.
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
 * Reservar. El alumno sale de la sesión y la hora de fin la calcula el
 * backend (la clase dura siempre 1 h), así que alcanza con fecha, docente,
 * materia y hora de inicio. Devuelve la clase guardada, sin envolver.
 */
export function bookLesson(lesson) {
  return request('/api/classes', {
    method: 'POST',
    body: JSON.stringify({
      date: lesson.date,
      teacherId: lesson.teacherId,
      subjectId: lesson.subjectId,
      startTime: lesson.startTime,
    }),
  })
}

/**
 * Reemplaza la semana entera de esa materia: lo que no va en `schedule` se
 * borra. El docente sale de la sesión en el backend, no se manda.
 */
export function saveAvailability(subjectId, schedule) {
  return request(`/api/subjects/${subjectId}/availability`, {
    method: 'PUT',
    body: JSON.stringify({ schedule }),
  })
}

/**
 * Guarda el perfil. Devuelve el usuario completo y actualizado (no envuelto
 * en { user }), igual que login y /me. El id sale de la sesión en el backend,
 * así que mandarlo en el body no cambiaría nada.
 */
export function updateProfile(payload) {
  return request('/api/users/me', {
    method: 'PATCH',
    body: JSON.stringify({
      telefono: payload.telefono,
      subjectIds: payload.subjectIds,
    }),
  })
}

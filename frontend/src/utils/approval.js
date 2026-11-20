// La aprobación de docentes, del lado del front. Los estados viajan en inglés
// ('pending' | 'approved' | 'rejected') y acá se traducen para mostrarlos.
//
// Las reglas de verdad viven en backend/src/lib/teacherApproval.js. Esto las
// copia SOLO para decidir qué botones mostrar (igual que utils/classStates.js
// con las reservas): si cambia una regla, cambiala en los dos lados. El
// backend vuelve a chequear y explica en su `message` si no se puede.
//
// El estado llega como `approvalStatus` (del usuario de la sesión, o de cada
// docente de GET /api/admin/teachers). Lo usan: pages/Admin/AdminPage.jsx,
// pages/Profile/ProfilePage.jsx y pages/Availability/AvailabilityPage.jsx.

const LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
}

// Mismos tonos que las pastillas de estado de las reservas (ClassActions.css).
const TONES = {
  pending: 'warning',
  approved: 'success',
  rejected: 'danger',
}

/**
 * El texto en pantalla de un estado ('pending' -> 'Pendiente'); uno desconocido sale tal cual.
 * Lo usan: pages/Admin/AdminPage.jsx.
 */
export function approvalLabel(status) {
  return LABELS[status] || status
}

/**
 * El tono de la pastilla ('warning' | 'success' | 'danger', o 'muted' si no se conoce).
 * Lo usan: pages/Admin/AdminPage.jsx.
 */
export function approvalTone(status) {
  return TONES[status] || 'muted'
}

/**
 * Qué puede decidir el admin sobre un docente en ese estado.
 *
 * @param {string} status - `approvalStatus` de un docente de GET /api/admin/teachers.
 * @returns {{approve: boolean, reject: boolean}} qué botones mostrar.
 * Lo usan: pages/Admin/AdminPage.jsx.
 * Espejo: backend/src/lib/teacherApproval.js.
 */
export function allowedDecisions(status) {
  return {
    approve: status === 'pending' || status === 'rejected',
    reject: status === 'pending' || status === 'approved',
  }
}

/**
 * El aviso para el propio docente mientras no está aprobado, o null. Un
 * pendiente o rechazado puede seguir editando su perfil y su disponibilidad,
 * pero no aparece en las búsquedas ni recibe reservas.
 *
 * @param {object|null} user - el usuario de la sesión (App.state.user, de /api/auth/me).
 * @returns {string|null} el aviso, o null si no es docente o ya está aprobado.
 * Lo usan: pages/Profile/ProfilePage.jsx, pages/Availability/AvailabilityPage.jsx.
 */
export function approvalNotice(user) {
  if (user?.role !== 'teacher') return null
  if (user.approvalStatus === 'pending') {
    return 'Tu perfil está pendiente de aprobación. Mientras tanto podés completarlo y cargar tu disponibilidad, pero los alumnos todavía no te ven ni pueden reservarte clases.'
  }
  if (user.approvalStatus === 'rejected') {
    return 'Tu perfil fue rechazado y no aparece en las búsquedas. Revisá tus datos y guardá los cambios: así vuelve a quedar pendiente de aprobación.'
  }
  return null
}

// La aprobación de docentes, del lado del front. Los estados viajan en inglés
// ('pending' | 'approved' | 'rejected') y acá se traducen para mostrarlos.
//
// Las reglas de verdad viven en backend/src/lib/teacherApproval.js. Esto las
// copia SOLO para decidir qué botones mostrar (igual que utils/classStates.js
// con las reservas): si cambia una regla, cambiala en los dos lados. El
// backend vuelve a chequear y explica en su `message` si no se puede.

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

export function approvalLabel(status) {
  return LABELS[status] || status
}

export function approvalTone(status) {
  return TONES[status] || 'muted'
}

/** Qué puede decidir el admin sobre un docente en ese estado. */
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

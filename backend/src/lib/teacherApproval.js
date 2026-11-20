// La aprobación de un docente por parte de un administrador. Es un objeto y
// no un par de funciones sueltas porque las reglas giran todas alrededor de
// un único dato (el estado) y así se leen juntas: qué puede hacer el admin,
// qué pasa cuando el docente edita su perfil y si se le puede reservar.
//
// Como lib/bookingStates.js, no toca la base ni el reloj: se prueba solo, y la
// ruta decide qué guardar con lo que devuelve.
//
// Dato: users.approval_status (enum teacher_approval_status, migración 012),
// que llega por la sesión (request.user.approvalStatus) o por las consultas de
// db/* (window.teacherApprovalStatus, offer.teacherApprovalStatus...).
// Lo usan: routes/admin/index.js (check, approve, reject), routes/users/index.js
// (afterProfileEdit), routes/bookings/index.js y routes/packs/index.js
// (bookingProblem).
// Espejo: frontend/src/utils/approval.js, solo para elegir botones y avisos.

/** En inglés, como el rol: viajan por la API y el front los traduce. */
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected'];

const deny = (status, message) => ({ status, message });

// Desde qué estados se puede tomar cada decisión. Rechazar un aprobado se
// permite para poder dar de baja a alguien; sus clases ya reservadas siguen
// en pie (igual que cuando borra una ventana), solo deja de recibir nuevas.
const TRANSITIONS = {
  approve: {
    from: ['pending', 'rejected'],
    to: 'approved',
    already: 'Este docente ya está aprobado.',
  },
  reject: {
    from: ['pending', 'approved'],
    to: 'rejected',
    already: 'Este docente ya está rechazado.',
  },
};

export class TeacherApproval {
  /**
   * `status` es el de la columna users.approval_status: null para quien no es
   * docente (alumnos y admins no se aprueban).
   */
  constructor(status) {
    if (status !== null && status !== undefined && !APPROVAL_STATUSES.includes(status)) {
      throw new Error(`Estado de aprobación desconocido: ${status}`);
    }
    this.status = status ?? null;
  }

  /** ¿Está aprobado? Solo se usa adentro de la clase. */
  isApproved() {
    return this.status === 'approved';
  }

  /**
   * Mientras está pendiente o rechazado, el docente existe y edita su perfil,
   * pero no se lo ofrece a nadie: ni en el buscador, ni en el tablero, ni
   * acepta reservas aunque alguien tenga el id de una ventana suya.
   */
  canReceiveBookings() {
    return this.isApproved();
  }

  /**
   * null si se le puede reservar (o comprarle un paquete), o { status: 409,
   * message } para el alumno.
   * Lo usan: routes/bookings/index.js (checkWindowSlot) y routes/packs/index.js (comprar).
   */
  bookingProblem() {
    if (this.canReceiveBookings()) return null;
    return deny(409, 'Este docente todavía no puede recibir reservas.');
  }

  /**
   * null si el admin puede tomar esa decisión ahora, o { status, message }.
   * Mismo contrato que checkAction de lib/bookingStates.js.
   *
   * @param {'approve'|'reject'} action - la acción de la URL
   *   (POST /api/admin/teachers/:id/{approve,reject}).
   * @returns {null|{status: number, message: string}}
   * Lo usa: routes/admin/index.js.
   */
  check(action) {
    const transition = TRANSITIONS[action];
    if (!transition) return deny(400, 'Acción inválida');
    if (this.status === transition.to) return deny(409, transition.already);
    if (!transition.from.includes(this.status)) {
      return deny(409, 'Este docente no se puede revisar en su estado actual.');
    }
    return null;
  }

  /** El estado después de aprobar (otro objeto). Lo usa: routes/admin/index.js, después de check(). */
  approve() {
    return this.#apply('approve');
  }

  /** El estado después de rechazar ("Dar de baja"). Lo usa: routes/admin/index.js, después de check(). */
  reject() {
    return this.#apply('reject');
  }

  /**
   * Cómo queda después de que el docente guarda su perfil. Un rechazado que
   * corrige sus datos vuelve a la cola del admin: si no, rechazado sería un
   * estado sin salida y editar el perfil no serviría de nada.
   * @returns {TeacherApproval} el mismo objeto, o uno nuevo en 'pending'.
   * Lo usa: routes/users/index.js (PATCH /api/users/me, con request.user.approvalStatus).
   */
  afterProfileEdit() {
    return this.status === 'rejected' ? new TeacherApproval('pending') : this;
  }

  // Devuelve otro objeto en vez de mutar este: quien llama compara el estado
  // viejo con el nuevo para la escritura optimista (ver setTeacherApproval).
  // No vuelve a llamar a check(): la ruta de admin lo hace antes para poder
  // contestar con el status y el mensaje, y acá ya no hay error que dar.
  #apply(action) {
    return new TeacherApproval(TRANSITIONS[action].to);
  }
}

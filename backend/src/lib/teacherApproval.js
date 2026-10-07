// La aprobación de un docente por parte de un administrador. Es un objeto y
// no un par de funciones sueltas porque las reglas giran todas alrededor de
// un único dato (el estado) y así se leen juntas: qué puede hacer el admin,
// qué pasa cuando el docente edita su perfil y si se le puede reservar.
//
// Como lib/classStates.js, no toca la base ni el reloj: se prueba solo, y la
// ruta decide qué guardar con lo que devuelve.

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

  /** null si se le puede reservar, o { status, message } para el alumno. */
  bookingProblem() {
    if (this.canReceiveBookings()) return null;
    return deny(409, 'Este docente todavía no puede recibir reservas.');
  }

  /**
   * null si el admin puede tomar esa decisión ahora, o { status, message }.
   * Mismo contrato que checkAction de lib/classStates.js.
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

  approve() {
    return this.#apply('approve');
  }

  reject() {
    return this.#apply('reject');
  }

  /**
   * Cómo queda después de que el docente guarda su perfil. Un rechazado que
   * corrige sus datos vuelve a la cola del admin: si no, rechazado sería un
   * estado sin salida y editar el perfil no serviría de nada.
   */
  afterProfileEdit() {
    return this.status === 'rejected' ? new TeacherApproval('pending') : this;
  }

  // Devuelve otro objeto en vez de mutar este: quien llama compara el estado
  // viejo con el nuevo para la escritura optimista (ver setTeacherApproval).
  #apply(action) {
    const denied = this.check(action);
    if (denied) throw new Error(denied.message);
    return new TeacherApproval(TRANSITIONS[action].to);
  }
}

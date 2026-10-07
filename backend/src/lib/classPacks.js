// Los paquetes de clases: lo que el docente ofrece y lo que el alumno compró.
//
// Como lib/teacherApproval.js, no toca la base ni el reloj: recibe "hoy" y
// las cuentas ya hechas, así cada regla se prueba sola.
//
// Lo que le queda a un paquete NO es un contador guardado: sale de contar
// sus clases. Así, corregir una asistencia o cancelar una reserva devuelve la
// clase sin que nadie tenga que acordarse de sumarla de nuevo.

const MIN_CLASSES = 2;
const MAX_CLASSES = 100;
const MAX_VALIDITY_DAYS = 365;
// El mismo techo que el CHECK de class_packs.
const MAX_PRICE_CENTS = 1000000000;

const isIntBetween = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * Valida un paquete tal como lo manda el docente: { classCount, priceCents,
 * validityDays }. Devuelve { value } o { message, fields }, igual que
 * validateWindow y validateRates.
 */
export function validatePackOffer(body) {
  const { classCount, priceCents, validityDays } = body ?? {};

  if (!isIntBetween(classCount, MIN_CLASSES, MAX_CLASSES)) {
    return {
      message: `Un paquete tiene entre ${MIN_CLASSES} y ${MAX_CLASSES} clases.`,
      fields: { classCount: 'invalid' },
    };
  }
  if (!isIntBetween(priceCents, 0, MAX_PRICE_CENTS)) {
    return {
      message: 'El precio tiene que ser un monto en pesos (con hasta dos decimales).',
      fields: { priceCents: 'invalid' },
    };
  }
  if (!isIntBetween(validityDays, 1, MAX_VALIDITY_DAYS)) {
    return {
      message: `El paquete tiene que durar entre 1 y ${MAX_VALIDITY_DAYS} días.`,
      fields: { validityDays: 'invalid' },
    };
  }
  return { value: { classCount, priceCents, validityDays } };
}

/**
 * El último día en que vale un paquete comprado `today` que dura
 * `validityDays` días: comprado hoy por 1 día, vale solo hoy.
 */
export function expiryFor(today, validityDays) {
  const [y, m, d] = today.split('-').map(Number);
  // UTC solo para sumar días sin que un cambio de horario corra la fecha.
  const date = new Date(Date.UTC(y, m - 1, d + validityDays - 1));
  return date.toISOString().slice(0, 10);
}

const deny = (message) => ({ status: 409, message });

function formatDay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export class StudentPack {
  /**
   * `attended`: clases del paquete que quedaron realizadas (las que ya lo
   * descontaron). `reserved`: las que están en curso (pendiente, aceptada o
   * confirmada), que todavía no descontaron pero ya tienen su lugar
   * apartado. Una ausente o una cancelada no cuenta para ninguna de las dos.
   */
  constructor({ id, classCount, expiresOn, attended = 0, reserved = 0 }) {
    this.id = id;
    this.classCount = classCount;
    this.expiresOn = expiresOn;
    this.attended = attended;
    this.reserved = reserved;
  }

  /** Las clases que le quedan: cada asistencia descuenta una. */
  remaining() {
    return Math.max(this.classCount - this.attended, 0);
  }

  /** Las que todavía se pueden reservar: las que quedan menos las ya reservadas. */
  available() {
    return Math.max(this.remaining() - this.reserved, 0);
  }

  isExpired(today) {
    return today > this.expiresOn;
  }

  /**
   * null si con este paquete se puede reservar una clase el día `date`, o
   * { status, message } para el alumno.
   */
  bookingProblem({ date, today }) {
    if (this.isExpired(today)) return deny(`Tu paquete venció el ${formatDay(this.expiresOn)}.`);
    if (date > this.expiresOn) {
      return deny(`Tu paquete vence el ${formatDay(this.expiresOn)}: elegí una clase hasta ese día.`);
    }
    if (this.available() === 0) {
      return deny(
        this.remaining() === 0
          ? 'Ya usaste todas las clases de tu paquete.'
          : 'Ya tenés reservadas todas las clases que te quedan en el paquete.'
      );
    }
    return null;
  }

  /** Lo que viaja por la API, con las cuentas ya hechas. */
  summary(today) {
    return {
      remaining: this.remaining(),
      available: this.available(),
      expired: this.isExpired(today),
    };
  }

  /**
   * De los paquetes del alumno con un docente, con cuál reservar una clase
   * ese día: el que vence primero entre los que sirven, para que no se le
   * venza uno con clases sin usar. Devuelve { pack } o { error }.
   */
  static choose(packs, { date, today }) {
    if (packs.length === 0) {
      return { error: deny('No tenés un paquete con este docente.') };
    }
    const ordered = [...packs].sort((a, b) => a.expiresOn.localeCompare(b.expiresOn));
    const usable = ordered.find((pack) => pack.bookingProblem({ date, today }) === null);
    if (usable) return { pack: usable };
    // Ninguno sirve: se explica con el que más cerca estuvo (el último en
    // vencer, que es el que más probablemente sigue vigente).
    return { error: ordered[ordered.length - 1].bookingProblem({ date, today }) };
  }
}

// Los paquetes de clases: lo que el docente ofrece y lo que el alumno compró.
//
// Como lib/teacherApproval.js, no toca la base ni el reloj: recibe "hoy" y
// las cuentas ya hechas, así cada regla se prueba sola.
//
// Cada clase del paquete dura lo mismo (lo decide el docente: "8 clases de
// 1 h"). Al reservar, el alumno elige cuántas usa (una o más) y la duración de
// su clase como siempre: lo que cubren las del paquete no se paga, y lo que se
// pasa se paga aparte con la tarifa ("1 clase de 1 h + 30 min").
//
// Lo que le queda a un paquete NO es un contador guardado: sale de sumar las
// clases del paquete que usó cada reserva. Así, corregir una asistencia o
// cancelar una reserva las devuelve sin que nadie tenga que acordarse.
//
// Tablas: class_packs (lo que ofrece el docente) y student_packs (lo comprado),
// migraciones 014 y 015; las reservas que usan un paquete tienen
// classes.student_pack_id y classes.pack_tokens.
// Lo usan: routes/teachers/index.js (validatePackOffer), routes/packs/index.js
// (expiryFor, StudentPack.summary), routes/classes/index.js y db/classes.js
// (StudentPack.bookingProblem: la ruta chequea y db/classes.js lo repite bajo
// el lock del paquete).
// Relacionado: frontend/src/utils/packs.js NO recalcula estas cuentas; usa
// `remaining`/`available`/`expired` que vienen de summary().

// Topes del paquete según CLAUDE.md ("Class packs"): classCount 2–100,
// validityDays 1–365 (contados desde el día de compra, inclusive).
const MIN_CLASSES = 2;
const MAX_CLASSES = 100;
const MAX_VALIDITY_DAYS = 365;
// classMinutes 30–240 de a 5 (CLAUDE.md). La clase más corta que se puede
// reservar, y de a 5 como la duración que elige el alumno. El techo es de
// sentido común.
const MIN_CLASS_MINUTES = 30;
const MAX_CLASS_MINUTES = 240;
const CLASS_MINUTES_STEP = 5;
// El mismo techo que el CHECK de class_packs.
const MAX_PRICE_CENTS = 1000000000;

const isIntBetween = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;

/**
 * Valida un paquete tal como lo manda el docente. Devuelve { value } o
 * { message, fields }, igual que validateWindow y validateRates.
 *
 * @param {object} body - el body de POST /api/teachers/me/packs:
 *   { classCount, classMinutes, priceCents, validityDays }, todos enteros
 *   (precio en centavos).
 * @returns {{value: object}|{message: string, fields: object}} `value` con esos
 *   cuatro campos, listo para createOffer (db/packs.js → class_packs).
 * Lo usa: routes/teachers/index.js.
 */
export function validatePackOffer(body) {
  const { classCount, classMinutes, priceCents, validityDays } = body ?? {};

  if (!isIntBetween(classCount, MIN_CLASSES, MAX_CLASSES)) {
    return {
      message: `Un paquete tiene entre ${MIN_CLASSES} y ${MAX_CLASSES} clases.`,
      fields: { classCount: 'invalid' },
    };
  }
  if (
    !isIntBetween(classMinutes, MIN_CLASS_MINUTES, MAX_CLASS_MINUTES) ||
    classMinutes % CLASS_MINUTES_STEP !== 0
  ) {
    return {
      message: `Cada clase dura entre ${MIN_CLASS_MINUTES} minutos y ${MAX_CLASS_MINUTES / 60} horas, de a ${CLASS_MINUTES_STEP} minutos.`,
      fields: { classMinutes: 'invalid' },
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
  return { value: { classCount, classMinutes, priceCents, validityDays } };
}

/**
 * El último día en que vale un paquete comprado `today` que dura
 * `validityDays` días: comprado hoy por 1 día, vale solo hoy.
 *
 * @param {string} today - todayIso() (lib/clock.js), el día de la compra.
 * @param {number} validityDays - class_packs.validity_days de la oferta que se compra.
 * @returns {string} 'YYYY-MM-DD', que se guarda en student_packs.expires_on.
 * Lo usa: routes/packs/index.js (POST /api/packs/:id/buy).
 */
export function expiryFor(today, validityDays) {
  const [y, m, d] = today.split('-').map(Number);
  // UTC solo para sumar días sin que un cambio de horario corra la fecha.
  const date = new Date(Date.UTC(y, m - 1, d + validityDays - 1));
  return date.toISOString().slice(0, 10);
}

const deny = (message, status = 409) => ({ status, message });

function formatDay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** 60 -> '1 h', 90 -> '1 h 30 min', 45 -> '45 min'. */
function formatMinutes(total) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const clases = (n) => (n === 1 ? '1 clase' : `${n} clases`);

/**
 * Un paquete comprado por un alumno, con las cuentas de cuántas clases le
 * quedan y la regla de si se puede usar en una reserva. No lee nada: recibe la
 * fila ya armada por listStudentPacks / findStudentPack (db/packs.js), que
 * suman los pack_tokens de las reservas del paquete.
 */
export class StudentPack {
  /**
   * @param {object} row - { id, classCount, classMinutes, expiresOn, attended,
   *   reserved }: student_packs + las sumas de pack_tokens de sus clases.
   * `attended`: clases del paquete que usaron las reservas realizadas (las que
   * ya lo descontaron). `reserved`: las que usan las reservas en curso
   * (pendiente, aceptada o confirmada), que todavía no descontaron pero ya
   * tienen su lugar apartado. Una ausente o una cancelada no cuenta para
   * ninguna de las dos. `teacherApproved`: si el docente sigue aprobado (sin
   * eso no se le puede reservar, y el paquete no sirve aunque le queden clases).
   */
  constructor({
    id,
    classCount,
    classMinutes,
    expiresOn,
    attended = 0,
    reserved = 0,
    teacherApproved = false,
  }) {
    this.id = id;
    this.teacherApproved = Boolean(teacherApproved);
    this.classCount = classCount;
    this.classMinutes = classMinutes;
    this.expiresOn = expiresOn;
    this.attended = attended;
    this.reserved = reserved;
  }

  /** Las clases que le quedan: cada asistencia descuenta las que usó. */
  remaining() {
    return Math.max(this.classCount - this.attended, 0);
  }

  /** Las que todavía se pueden reservar: las que quedan menos las ya reservadas. */
  available() {
    return Math.max(this.remaining() - this.reserved, 0);
  }

  /** ¿Ya pasó su último día? `today` 'YYYY-MM-DD' de lib/clock.js. */
  isExpired(today) {
    return today > this.expiresOn;
  }

  /** Cuántos minutos de la clase cubren `tokens` clases del paquete. */
  coveredMinutes(tokens) {
    return tokens * this.classMinutes;
  }

  /** Lo que se paga aparte en una clase de `minutes` usando `tokens`. */
  extraMinutes({ tokens, minutes }) {
    return Math.max(minutes - this.coveredMinutes(tokens), 0);
  }

  /**
   * ¿Se puede reservar con este paquete una clase de `minutes` el día `date`
   * usando `tokens` clases del paquete? Chequea: tokens ≥1, que no esté vencido
   * ni venza antes de la clase, que los tokens no cubran más de lo que dura la
   * clase y que queden disponibles.
   *
   * @param {object} args
   * @param {string} args.date - fecha de la clase ('YYYY-MM-DD', del body de la reserva).
   * @param {string} args.today - now().iso de lib/clock.js.
   * @param {number} args.tokens - body.packTokens de POST /api/classes (o reprogramar).
   * @param {number} args.minutes - body.durationMinutes.
   * @returns {null|{status: number, message: string}} null si se puede; si no,
   *   400 (pedido mal armado) o 409 (el paquete no alcanza) con el motivo.
   * Lo usan: routes/classes/index.js (priceBooking) y db/classes.js (re-chequeo bajo lock).
   */
  bookingProblem({ date, today, tokens, minutes }) {
    if (!Number.isInteger(tokens) || tokens < 1) {
      return deny('Elegí cuántas clases del paquete usás.', 400);
    }
    if (this.isExpired(today)) return deny(`Tu paquete venció el ${formatDay(this.expiresOn)}.`);
    if (date > this.expiresOn) {
      return deny(`Tu paquete vence el ${formatDay(this.expiresOn)}: elegí una clase hasta ese día.`);
    }
    // Las del paquete no pueden cubrir más de lo que dura la clase: sería
    // gastar clases de más.
    if (this.coveredMinutes(tokens) > minutes) {
      return deny(
        `${clases(tokens)} de ${formatMinutes(this.classMinutes)} cubren más que una clase de ${formatMinutes(minutes)}. Usá menos o alargá la clase.`,
        400
      );
    }
    if (this.available() < tokens) {
      if (this.remaining() === 0) return deny('Ya usaste todas las clases de tu paquete.');
      if (this.available() === 0) {
        return deny('Ya tenés reservadas todas las clases que te quedan en el paquete.');
      }
      const queda = this.available() === 1 ? 'queda' : 'quedan';
      return deny(`Solo te ${queda} ${clases(this.available())} del paquete para reservar.`);
    }
    return null;
  }

  /**
   * Lo que viaja por la API, con las cuentas ya hechas.
   * @param {string} today - todayIso() de lib/clock.js.
   * @returns {{remaining: number, available: number, expired: boolean, usable: boolean}}
   *   se mezcla con la fila del paquete. `usable`: si hoy sirve para reservar
   *   (no venció, le quedan clases sin reservar y el docente está aprobado),
   *   así el front no tiene que re-decidirlo.
   * Lo usa: routes/packs/index.js (withSummary).
   */
  summary(today) {
    const expired = this.isExpired(today);
    return {
      remaining: this.remaining(),
      available: this.available(),
      expired,
      usable: !expired && this.available() > 0 && this.teacherApproved,
    };
  }
}

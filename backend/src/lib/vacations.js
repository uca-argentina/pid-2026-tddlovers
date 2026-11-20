// Las vacaciones del docente (en pantalla, "Licencia"): rangos de días (los
// dos extremos incluidos) en los que no se le puede reservar nada.
//
// Tabla: teacher_vacations (migración 016). Lo usan routes/teachers/index.js
// (validate y describe en /me/vacations), lib/availabilityExpansion.js
// (covers: marca onVacation en el tablero) y VACATION_MESSAGE lo usan
// routes/classes/index.js y db/classes.js al rechazar una reserva.
// Espejo: frontend/src/utils/vacations.js (isOnVacation, vacationRangeError).
//
// Como lib/classPacks.js y lib/teacherApproval.js, no toca la base ni el
// reloj: recibe "hoy" y las cosas ya leídas, así cada regla se prueba sola.

import { isRealDate } from './validators.js';

// Un rango dura ≤365 días (CLAUDE.md, "Teacher vacations"). Techo de sentido
// común: frena un typo de año ("2062") que dejaría al docente sin clases por décadas.
const MAX_DAYS = 365;

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const fail = (message, field) => ({ message, fields: { [field]: 'invalid' } });

/** Un rango de licencia { id, startDate, endDate }, ambos 'YYYY-MM-DD' inclusive. */
export class VacationRange {
  /** @param {{id?: string|null, startDate: string, endDate: string}} range - una fila de teacher_vacations o el body ya validado. */
  constructor({ id = null, startDate, endDate }) {
    this.id = id;
    this.startDate = startDate;
    this.endDate = endDate;
  }

  /**
   * Valida un rango tal como lo manda el docente: { startDate, endDate }.
   * Devuelve { value } (un VacationRange) o { message, fields }.
   *
   * No se cargan vacaciones que ya terminaron: no bloquearían nada y solo
   * ensuciarían la lista. Sí pueden empezar antes de hoy si siguen (se fue
   * ayer y se acordó de cargarlo hoy).
   *
   * @param {object} body - body de POST /api/teachers/me/vacations, o la query de
   *   GET /me/vacations/impact (mismos campos).
   * @param {{today: string}} opts - todayIso() de lib/clock.js.
   * Lo usa: routes/teachers/index.js.
   */
  static validate(body, { today }) {
    const { startDate, endDate } = body ?? {};
    if (!isRealDate(startDate)) return fail('Elegí desde qué día.', 'startDate');
    if (!isRealDate(endDate)) return fail('Elegí hasta qué día.', 'endDate');
    if (endDate < startDate) {
      return fail('El último día no puede ser antes del primero.', 'endDate');
    }
    if (endDate < today) return fail('Esa licencia ya terminó.', 'endDate');
    if (daysBetween(startDate, endDate) + 1 > MAX_DAYS) {
      return fail(`Una licencia puede durar hasta ${MAX_DAYS} días.`, 'endDate');
    }
    return { value: new VacationRange({ startDate, endDate }) };
  }

  /** ¿Ese día cae adentro? Los dos extremos cuentan. */
  includes(iso) {
    return iso >= this.startDate && iso <= this.endDate;
  }

  /**
   * El rango en texto para un mensaje: "el 01/01/2027" o "del 01/01/2027 al
   * 15/01/2027". Lo usa: routes/teachers/index.js ("Se pisa con tu licencia ...").
   */
  describe() {
    return this.startDate === this.endDate
      ? `el ${formatDay(this.startDate)}`
      : `del ${formatDay(this.startDate)} al ${formatDay(this.endDate)}`;
  }

  /**
   * ¿El docente está de vacaciones ese día? `ranges` son sus vacaciones (o
   * las de varios docentes, con teacherId).
   *
   * @param {Array<{teacherId?, startDate, endDate}>} ranges - en el tablero,
   *   listVacationsInRange (db/vacations.js).
   * @param {string} iso - el día, 'YYYY-MM-DD'.
   * @param {string|null} [teacherId] - si viene, solo cuentan los rangos de ese docente.
   * @returns {boolean}
   * Lo usa: lib/availabilityExpansion.js (bookableRows).
   */
  static covers(ranges, iso, teacherId = null) {
    return ranges.some(
      (range) =>
        (teacherId === null || String(range.teacherId) === String(teacherId)) &&
        new VacationRange(range).includes(iso)
    );
  }
}

// El 409 de reservar (o reprogramar) en un día de licencia: lo devuelven la
// ruta (routes/classes/index.js) y el re-chequeo bajo lock de db/classes.js.
export const VACATION_MESSAGE = 'El docente está de licencia ese día.';

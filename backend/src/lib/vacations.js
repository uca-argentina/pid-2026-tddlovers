// Las vacaciones del docente: rangos de días (los dos extremos incluidos) en
// los que no se le puede reservar nada.
//
// Como lib/classPacks.js y lib/teacherApproval.js, no toca la base ni el
// reloj: recibe "hoy" y las cosas ya leídas, así cada regla se prueba sola.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Un techo de sentido común: frena un typo de año ("2062") que dejaría al
// docente sin clases por décadas.
const MAX_DAYS = 365;

function isRealDate(iso) {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) return false;
  // '2026-02-31' pasa la regex pero no existe: Date la corre al 3 de marzo.
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso;
}

function daysBetween(from, to) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function formatDay(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const fail = (message, field) => ({ message, fields: { [field]: 'invalid' } });

export class VacationRange {
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
   */
  static validate(body, { today }) {
    const { startDate, endDate } = body ?? {};
    if (!isRealDate(startDate)) return fail('Elegí desde qué día.', 'startDate');
    if (!isRealDate(endDate)) return fail('Elegí hasta qué día.', 'endDate');
    if (endDate < startDate) {
      return fail('El último día no puede ser antes del primero.', 'endDate');
    }
    if (endDate < today) return fail('Esas vacaciones ya terminaron.', 'endDate');
    if (daysBetween(startDate, endDate) + 1 > MAX_DAYS) {
      return fail(`Las vacaciones pueden durar hasta ${MAX_DAYS} días.`, 'endDate');
    }
    return { value: new VacationRange({ startDate, endDate }) };
  }

  /** ¿Ese día cae adentro? Los dos extremos cuentan. */
  includes(iso) {
    return iso >= this.startDate && iso <= this.endDate;
  }

  /** ¿Comparten algún día? */
  overlaps(other) {
    return this.startDate <= other.endDate && other.startDate <= this.endDate;
  }

  days() {
    return daysBetween(this.startDate, this.endDate) + 1;
  }

  /** "Ya tenés vacaciones del 01/01/2027 al 15/01/2027." */
  describe() {
    return this.startDate === this.endDate
      ? `el ${formatDay(this.startDate)}`
      : `del ${formatDay(this.startDate)} al ${formatDay(this.endDate)}`;
  }

  /** El primero de `ranges` que se pisa con este, o null. */
  firstOverlap(ranges) {
    return ranges.find((other) => this.overlaps(other)) ?? null;
  }

  /**
   * ¿El docente está de vacaciones ese día? `ranges` son sus vacaciones (o
   * las de varios docentes, con teacherId).
   */
  static covers(ranges, iso, teacherId = null) {
    return ranges.some(
      (range) =>
        (teacherId === null || String(range.teacherId) === String(teacherId)) &&
        new VacationRange(range).includes(iso)
    );
  }
}

export const VACATION_MESSAGE = 'El docente está de vacaciones ese día.';

import { isRealDate } from './validators.js';
import { VacationRange } from './vacations.js';

// El puente entre las ventanas que carga el docente y las fechas que reserva
// el alumno (ver CLAUDE.md, "windows → dated availability"). Una
// ventana tiene una fecha y puede repetirse todas las semanas; acá se
// proyecta sobre el rango pedido y se resta lo ya reservado.
//
// Todo se hace en minutos desde medianoche: comparar 'HH:MM' como texto
// funciona de casualidad y se rompe con '24:00'.
//
// No toca la base: recibe las ventanas (availability, vía findPublishedWindows
// de db/availability.js), los turnos ocupados (findTakenSlots de
// db/classes.js) y las licencias (listVacationsInRange de db/vacations.js) ya
// leídos por routes/availability/index.js, que es quien arma GET /api/availability.
// También exporta utilidades de horas y fechas que usan routes/classes,
// routes/teachers, db/classes y lib/availabilityWindow.
// Espejo parcial: frontend/src/utils/windows.js (occursOn) y
// frontend/src/utils/booking.js (toMinutes, dayKeyFromIso, startOptions).

const DAY_KEYS = [
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
];

// Los arranques van de a media hora; los finales, donde caiga la duración
// que elija el alumno.
const STEP_MINUTES = 30;
// La clase más corta que se puede reservar: un tramo más chico no sirve.
// (Mismo valor que MIN_CLASS_MINUTES de lib/teacherRates.js, copiado acá.)
const MIN_CLASS_MINUTES = 30;

/**
 * 'HH:MM' → minutos desde medianoche ('24:00' → 1440).
 * Lo usan: lib/availabilityWindow.js, routes/classes/index.js y db/classes.js.
 */
export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Minutos desde medianoche → 'HH:MM' (1440 → '24:00'). Inversa de toMinutes.
 * Lo usa: routes/classes/index.js (para calcular el endTime de una reserva).
 */
export function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * 'YYYY-MM-DD' -> 'lunes' (clave ASCII sin tildes, ver CLAUDE.md). getUTCDay: 0
 * es domingo y la semana arranca lunes. Solo se usa en este archivo.
 */
export function dayKeyFromIso(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return DAY_KEYS[(date.getUTCDay() + 6) % 7];
}

// Tope de días de un rango pedido. La UI pide como mucho la grilla de un mes
// (6 semanas, 42 días) y el docente una semana; esto da margen de sobra y
// frena un `to=9999-12-31` que haría iterar millones de días.
export const MAX_RANGE_DAYS = 93;

/**
 * Valida el `?from&to` que piden las pantallas de disponibilidad. Una fecha que
 * no existe ('2026-02-30') pasa la regex pero rompe en Postgres con un 500: por
 * eso isRealDate.
 *
 * @param {string} from - request.query.from ('YYYY-MM-DD').
 * @param {string} to - request.query.to ('YYYY-MM-DD', inclusive).
 * @returns {string|null} null si está bien, o el mensaje para el 400.
 * Lo usan: routes/availability/index.js (GET /api/availability) y
 *   routes/teachers/index.js (GET /me/availability).
 */
export function dateRangeProblem(from, to) {
  if (!isRealDate(from) || !isRealDate(to)) return 'Rango de fechas inválido';
  if (from > to) return 'El rango de fechas está al revés';
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (days > MAX_RANGE_DAYS) return `El rango de fechas puede tener hasta ${MAX_RANGE_DAYS} días`;
  return null;
}

/**
 * `taken` sin una clase: al reprogramar, la clase vieja se cancela en la
 * misma transacción que reserva la nueva, así que su horario tiene que
 * ofrecerse (moverla media hora se pisa con ella misma). En una grupal solo
 * libera su lugar: el docente la sigue dando para los demás.
 *
 * @param {Array<object>} taken - los turnos ocupados, de findTakenSlots (db/classes.js).
 * @param {object} cls - la clase que se reprograma ({ teacherId, date, startTime,
 *   endTime, subjectId }); en la ruta es la clase de `?excludeClassId=` (findClassById),
 *   que el tablero manda cuando está en modo `?reprogramar=<classId>`.
 * @returns {Array<object>} una copia de `taken` sin ese turno (o con un anotado menos).
 * Lo usa: routes/availability/index.js.
 */
export function withoutClass(taken, cls) {
  const result = [];
  for (const group of taken) {
    const isTurn =
      String(group.teacherId) === String(cls.teacherId) &&
      group.date === cls.date &&
      group.start === cls.startTime &&
      group.end === cls.endTime &&
      String(group.subjectId) === String(cls.subjectId);
    if (!isTurn) result.push(group);
    else if (group.enrolled > 1) result.push({ ...group, enrolled: group.enrolled - 1 });
  }
  return result;
}

/** Cada fecha 'YYYY-MM-DD' del rango, inclusive los dos extremos. Solo se usa en este archivo. */
export function datesBetween(from, to) {
  const dates = [];
  const cursor = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

/**
 * ¿La ventana cae en esa fecha? La fecha misma, o —si se repite— cualquier
 * fecha posterior del mismo día de la semana. Nunca antes: una clase semanal
 * que se cargó hoy no aparece en las semanas que ya pasaron.
 *
 * @param {{date: string, repeatsWeekly: boolean}} window - una fila de availability
 *   (findPublishedWindows / findWindowById de db/availability.js).
 * @param {string} iso - la fecha a probar, 'YYYY-MM-DD'.
 * @returns {boolean}
 * Lo usan: este archivo (expandAvailability) y routes/classes/index.js (al
 *   reservar, para confirmar que la ventana sigue ofreciendo esa fecha).
 * Espejo: frontend/src/utils/windows.js (occursOn).
 */
export function occursOn(window, iso) {
  if (iso === window.date) return true;
  return (
    window.repeatsWeekly && iso > window.date && dayKeyFromIso(iso) === dayKeyFromIso(window.date)
  );
}

/**
 * Lo que el alumno puede hacer en UNA ocurrencia (ventana + fecha) de una ventana:
 *
 *  - `free`: los tramos donde el docente no tiene ninguna clase (de esta
 *    ventana o de otra: no da dos a la vez). `start` es el primer :00/:30
 *    del tramo y `end` donde termina el tramo, que puede ser cualquier minuto
 *    (una clase de 13:00 a 13:45 deja libre desde 13:45 → start 14:00). La
 *    duración la elige el alumno al reservar, así que no se puede dar una
 *    lista cerrada de turnos: el front ofrece los inicios y las duraciones
 *    que entran, y el backend lo vuelve a validar al reservar.
 *  - `groups`: clases grupales ya armadas con lugar. Sumarse es tomar la
 *    MISMA clase: misma hora, materia y duración. Solo de materias que el
 *    docente todavía tarifa en esta modalidad — sin tarifa no hay precio.
 *
 * @param {object} window - la ventana, con `start`, `end`, `maxStudents` y
 *   `subjects` (las materias que el docente tarifa en su modalidad).
 * @param {Array<object>} taken - las clases del docente ese día, agrupadas por
 *   turno ({ start, end, subjectId, subjectName, enrolled }).
 * @param {number|null} [cutoff] - minutos desde medianoche de "ahora" si la fecha
 *   es hoy (descarta lo que ya empezó); null si el día es futuro.
 * @returns {{free: Array<{start, end}>, groups: Array<{start, end, subjectId, subjectName, enrolled}>}}
 * Lo usa: expandAvailability (este archivo).
 */
export function openingsForWindow(window, taken, cutoff = null) {
  const winFrom = toMinutes(window.start);
  const winTo = toMinutes(window.end);
  const alreadyStarted = (minutes) => cutoff !== null && minutes <= cutoff;
  const tarifadas = new Set((window.subjects ?? []).map((subject) => String(subject.id)));

  const groups = [];
  if (window.maxStudents > 1) {
    for (const group of taken) {
      const from = toMinutes(group.start);
      // Tiene que entrar entera: si la ventana se achicó, o la clase vino de
      // otra ventana que se borró, sumarse daría un 409 al reservar.
      const joinable =
        from >= winFrom &&
        toMinutes(group.end) <= winTo &&
        tarifadas.has(String(group.subjectId)) &&
        group.enrolled < window.maxStudents &&
        !alreadyStarted(from);
      if (joinable) {
        groups.push({
          start: group.start,
          end: group.end,
          subjectId: group.subjectId,
          subjectName: group.subjectName,
          enrolled: group.enrolled,
        });
      }
    }
  }
  groups.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  // Se recorre la ventana saltando por encima de cada clase del docente.
  const busy = taken
    .map((group) => ({ from: toMinutes(group.start), to: toMinutes(group.end) }))
    .filter((span) => span.from < winTo && span.to > winFrom)
    .sort((a, b) => a.from - b.from);

  const free = [];
  const pushGap = (from, to) => {
    let first = Math.ceil(from / STEP_MINUTES) * STEP_MINUTES;
    // Hoy: el primer inicio que todavía no pasó.
    if (cutoff !== null && first <= cutoff) {
      first = (Math.floor(cutoff / STEP_MINUTES) + 1) * STEP_MINUTES;
    }
    if (first + MIN_CLASS_MINUTES <= to) free.push({ start: toTime(first), end: toTime(to) });
  };

  let cursor = winFrom;
  for (const span of busy) {
    if (span.from > cursor) pushGap(cursor, Math.min(span.from, winTo));
    cursor = Math.max(cursor, span.to);
    if (cursor >= winTo) break;
  }
  if (cursor < winTo) pushGap(cursor, winTo);

  return { free, groups };
}

/**
 * Proyecta las ventanas sobre las fechas del rango: es lo que contesta
 * GET /api/availability. Devuelve una fila por (ventana, fecha) con lo que
 * queda para reservar; las que se quedan sin nada no salen (salvo las que caen
 * en licencia, ver abajo).
 *
 * Dos sentidos distintos de "reservado", y solo uno se resta:
 *  - Reservado CON ESE DOCENTE: ese rato deja de existir para todos (salvo
 *    el lugar que quede en una grupal), así que se resta.
 *  - Reservado por el alumno con OTRO docente: el rato del docente sigue
 *    existiendo, este alumno no puede tomarlo. NO se resta acá — el front lo
 *    pinta en gris con lo que devuelve /api/classes.
 *
 * `windows` trae `subjects`: [{ id, name, hourlyRateCents }], lo que se
 * puede reservar en cada una (ver findPublishedWindows).
 * `taken`: [{ teacherId, date, start, end, subjectId, subjectName, enrolled }],
 * un elemento por turno (una grupal con 3 alumnos es UNO con enrolled 3).
 *
 * El link de las virtuales y la dirección exacta de las presenciales no
 * salen: se los lleva el alumno recién al reservar. Para decidir alcanza con
 * la localidad.
 *
 * `vacations` son las del rango ([{ teacherId, startDate, endDate }]). Una
 * ventana que cae en vacaciones de su docente NO desaparece: sale con
 * `onVacation: true` y sin nada reservable, para que el alumno la vea en gris
 * y sepa por qué (y no crea que el docente dejó de dar esa clase).
 *
 * @param {object} args
 * @param {Array<object>} args.windows - findPublishedWindows (db/availability.js):
 *   solo docentes aprobados y modalidades con tarifa.
 * @param {Array<object>} args.taken - findTakenSlots (db/classes.js), quizás
 *   pasado por withoutClass si se está reprogramando.
 * @param {Array<object>} [args.vacations] - listVacationsInRange (db/vacations.js).
 * @param {string} args.from - request.query.from, ya validado con dateRangeProblem.
 * @param {string} args.to - request.query.to, inclusive.
 * @param {string} args.nowIso - now().iso de lib/clock.js: los días anteriores no salen.
 * @param {string} args.nowTime - now().time: hoy solo salen los inicios que no pasaron.
 * @returns {Array<object>} filas { id: '<windowId>|<fecha>', windowId, date, dayKey,
 *   teacherId, teacherName, teacherAcceptsRewards, teacherFeatured, start, end,
 *   modality, maxStudents, locality, subjects, free, groups, onVacation }.
 * Lo usa: routes/availability/index.js.
 */
export function expandAvailability({ windows, taken, vacations = [], from, to, nowIso, nowTime }) {
  const takenByTeacherDate = new Map();
  for (const group of taken) {
    const key = `${group.teacherId}|${group.date}`;
    if (!takenByTeacherDate.has(key)) takenByTeacherDate.set(key, []);
    takenByTeacherDate.get(key).push(group);
  }

  const rows = [];

  for (const iso of datesBetween(from, to)) {
    // Un día entero ya pasado no aporta nada.
    if (nowIso && iso < nowIso) continue;
    const cutoff = nowIso && iso === nowIso && nowTime ? toMinutes(nowTime) : null;

    for (const window of windows) {
      if (!occursOn(window, iso)) continue;
      if (!window.subjects || window.subjects.length === 0) continue;

      const onVacation = VacationRange.covers(vacations, iso, window.teacherId);
      const busy = takenByTeacherDate.get(`${window.teacherId}|${iso}`) ?? [];
      const { free, groups } = onVacation
        ? { free: [], groups: [] }
        : openingsForWindow(window, busy, cutoff);
      if (!onVacation && free.length === 0 && groups.length === 0) continue;

      rows.push({
        id: `${window.id}|${iso}`,
        windowId: window.id,
        date: iso,
        dayKey: dayKeyFromIso(iso),
        teacherId: window.teacherId,
        teacherName: window.teacherName,
        teacherAcceptsRewards: Boolean(window.teacherAcceptsRewards),
        teacherFeatured: Boolean(window.teacherFeatured),
        start: window.start,
        end: window.end,
        modality: window.modality,
        maxStudents: window.maxStudents,
        locality: window.locality ?? null,
        subjects: window.subjects,
        free,
        groups,
        onVacation,
      });
    }
  }

  return rows;
}

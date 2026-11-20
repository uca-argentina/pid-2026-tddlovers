import { isRealDate } from './validators.js';
import { VacationRange } from './vacations.js';

// El puente entre las ventanas que carga el docente y las fechas que reserva
// el alumno (ver CLAUDE.md, "windows → dated availability"). Una ventana
// tiene una fecha y puede repetirse todas las semanas; acá se proyecta sobre
// el rango pedido, se resta lo ya reservado con el docente y lo que el alumno
// ya tiene con cualquiera, y queda solo lo que ESTE alumno puede reservar
// (bookableRows). El backend decide qué se ve: el front no vuelve a filtrar.
//
// Todo se hace en minutos desde medianoche: comparar 'HH:MM' como texto
// funciona de casualidad y se rompe con '24:00'.
//
// No toca la base: recibe las ventanas (findPublishedWindows de
// db/availability.js), los turnos ocupados (findTakenSlots de db/classes.js),
// las licencias (listVacationsInRange de db/vacations.js) y las clases del
// alumno (findClassesForUser) ya leídos por routes/availability/index.js, que
// es quien arma GET /api/availability.
// También exporta utilidades de horas y fechas que usan routes/classes,
// routes/teachers, db/classes y lib/availabilityWindow.
// Espejo parcial: frontend/src/utils/windows.js (occursOn) y
// frontend/src/utils/booking.js (toMinutes, dayKeyFromIso).
//
// ÍNDICE — Filtros del backend (cada uno marcado en el código con "FILTRO:"):
//
// Tablero de disponibilidad (GET /api/availability)
//   db/availability.js:findPublishedWindows   docentes no aprobados y ventanas sin tarifa en su modalidad (único lugar de ese filtro)
//   db/classes.js:findTakenSlots              las canceladas no ocupan el horario del docente
//   routes/availability/index.js:classBeingRescheduled  ignora un excludeClassId ajeno o no confirmado
//   routes/availability/index.js:ownLessons   clases propias canceladas; a quien no es alumno no se le cruza nada
//   lib/availabilityExpansion.js:bookableRows días pasados, ventanas propias, otro docente/materia al reprogramar,
//                                             licencia de hoy ya terminada, filas sin inicios ni grupales
//   lib/availabilityExpansion.js:openingsForWindow  grupales a las que no se puede sumar (cupo/modalidad del turno,
//                                             tarifa, no entra, empezó, se pisa con una propia) e inicios dentro de una
//                                             clase propia o sin 30 min libres
// Buscador y favoritos
//   db/users.js:listTeachers                  no aprobados, sin materias tarifadas o sin ventana publicable vigente
//   db/favorites.js:listFavoriteTeachers      favoritos de docentes no aprobados (quedan guardados)
// Clases
//   db/classes.js:findClassesForUser          clases de otros usuarios, fuera del rango o de otro estado
//   db/classes.js:CLASS_COLUMNS               hasMaterial solo para reservas que pudieron darse
//   db/classes.js:findTurnClasses             las canceladas del turno
//   routes/classes/index.js:loadOwnClass      una clase ajena (404)
//   lib/classStates.js:canSeeExactAddress     la dirección exacta hasta que el alumno paga
//   lib/classStates.js:forViewer              aplica lo anterior a cada clase que va a un alumno
// Material de clase
//   lib/classMaterials.js:checkViewMaterial   material de clases que no se dieron o no terminaron
//   db/classMaterials.js:findMaterial         por turno; nunca la clave del bucket
// Admin
//   db/approvals.js:listTeachersForReview     no docentes y otros estados que el pedido
// Paquetes
//   db/packs.js:listTeacherOffers             paquetes desactivados
//   db/packs.js:listOffers                    inactivos o de docentes no aprobados
//   db/packs.js:listStudentPacks              paquetes de otros alumnos (no oculta vencidos: `usable` lo marca)
// Licencias
//   db/vacations.js:listTeacherVacations      las que ya terminaron
//   db/vacations.js:listVacationsInRange      las que no tocan el rango
// Tareas
//   db/homework.js:findTargets                alumnos sin clases con el docente y grupales viejas o canceladas
//   lib/homework.js:recentGroupSince          el corte de 60 días de las grupales
//   db/homework.js:listTeacherHomeworks       tareas de otros docentes
//   db/homework.js:listStudentHomeworks       las entregas de los compañeros
//   routes/homework/index.js:loadOwnSubmission  una entrega ajena (404)
// Neuronas
//   db/neuronas.js:findBalance                canjes de clases canceladas
//   db/neuronas.js:listMovements              movimientos de otros y canjes cancelados
//   db/neuronas.js:findFeaturedStatus         el cupo cuenta solo Destacados vigentes de aprobados
//   db/neuronas.js:buyFeatured                ídem al comprar
// Direcciones
//   db/addresses.js:listSavedAddresses        las sueltas (no guardadas)
//
// El índice del frontend está en frontend/src/utils/booking.js, y
// `grep -rn "FILTRO:"` los encuentra todos.

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
 * Lo usa: bookableRows (este archivo).
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


// La duración se elige de a 5 minutos (isValidClassMinutes de lib/teacherRates.js):
// el máximo de un inicio se redondea para abajo a ese paso.
const DURATION_STEP = 5;

/** El primer inicio :00/:30 que todavía no pasó (`cutoff` null = día futuro). */
function firstStartFrom(minutes, cutoff) {
  let first = Math.ceil(minutes / STEP_MINUTES) * STEP_MINUTES;
  if (cutoff !== null && first <= cutoff) {
    first = (Math.floor(cutoff / STEP_MINUTES) + 1) * STEP_MINUTES;
  }
  return first;
}

/** Las clases propias del alumno en una fecha, como tramos en minutos. */
function lessonSpans(lessons, iso) {
  return lessons
    .filter((lesson) => lesson.date === iso)
    .map((lesson) => ({ from: toMinutes(lesson.startTime), to: toMinutes(lesson.endTime) }));
}

/**
 * Lo que ESTE alumno puede hacer en UNA ocurrencia (ventana + fecha):
 *
 *  - `starts`: cada inicio :00/:30 con `maxMinutes`, la clase más larga que
 *    entra desde ahí. El techo es el primero de dos: el fin del tramo libre
 *    del docente (no da dos clases a la vez, de esta ventana o de otra) y el
 *    inicio de la próxima clase propia del alumno (con cualquier docente: no
 *    puede estar en dos lados). La duración la elige el alumno al reservar,
 *    así que no hay turnos cerrados; el backend lo vuelve a validar al reservar.
 *  - `groups`: grupales ya armadas a las que se puede sumar. Sumarse es tomar
 *    la MISMA clase: misma hora, materia y duración.
 *
 * @param {object} window - la ventana, con `start`, `end`, `modality` y
 *   `subjects` (las materias que el docente tarifa en su modalidad).
 * @param {Array<object>} taken - los turnos del docente ese día, de findTakenSlots
 *   ({ start, end, subjectId, subjectName, enrolled, maxStudents, modality }).
 * @param {object} [options]
 * @param {number|null} [options.cutoff] - minutos desde medianoche de "ahora" si la
 *   fecha es hoy (descarta lo que ya empezó); null si el día es futuro.
 * @param {Array<{from, to}>} [options.own] - las clases propias del alumno ese día, en minutos.
 * @returns {{starts: Array<{start, maxMinutes}>,
 *   groups: Array<{start, end, subjectId, subjectName, enrolled, maxStudents}>}}
 * Lo usa: bookableRows (este archivo).
 */
export function openingsForWindow(window, taken, { cutoff = null, own = [] } = {}) {
  const winFrom = toMinutes(window.start);
  const winTo = toMinutes(window.end);
  const alreadyStarted = (minutes) => cutoff !== null && minutes <= cutoff;
  const tarifadas = new Set((window.subjects ?? []).map((subject) => String(subject.id)));
  const clashesWithOwn = (from, to) => own.some((span) => span.from < to && from < span.to);

  const groups = [];
  for (const group of taken) {
    const from = toMinutes(group.start);
    const to = toMinutes(group.end);
    // FILTRO: solo las grupales a las que este alumno se puede sumar. El cupo y
    // la modalidad se miden contra lo COPIADO en las filas del turno, no contra
    // la ventana de hoy: insertClass copia lo del turno, así que si el docente
    // editó la ventana (subió el cupo, la pasó de individual a grupal o cambió
    // de modalidad) ofrecer según la ventana terminaba en un 409. Además: con
    // tarifa en esta modalidad (sin tarifa no hay precio), entera dentro de la
    // ventana (si se achicó, o vino de otra ventana borrada, daría 409), sin
    // empezar, y que no se pise con otra clase del alumno — eso incluye la
    // propia grupal si ya está anotado.
    const joinable =
      group.maxStudents > 1 &&
      group.enrolled < group.maxStudents &&
      group.modality === window.modality &&
      tarifadas.has(String(group.subjectId)) &&
      from >= winFrom &&
      to <= winTo &&
      !alreadyStarted(from) &&
      !clashesWithOwn(from, to);
    if (joinable) {
      groups.push({
        start: group.start,
        end: group.end,
        subjectId: group.subjectId,
        subjectName: group.subjectName,
        enrolled: group.enrolled,
        maxStudents: group.maxStudents,
      });
    }
  }
  groups.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));

  // Los tramos libres del docente: se recorre la ventana saltando por encima
  // de cada clase suya.
  const busy = taken
    .map((group) => ({ from: toMinutes(group.start), to: toMinutes(group.end) }))
    .filter((span) => span.from < winTo && span.to > winFrom)
    .sort((a, b) => a.from - b.from);
  const stretches = [];
  let cursor = winFrom;
  for (const span of busy) {
    if (span.from > cursor) stretches.push({ from: cursor, to: Math.min(span.from, winTo) });
    cursor = Math.max(cursor, span.to);
    if (cursor >= winTo) break;
  }
  if (cursor < winTo) stretches.push({ from: cursor, to: winTo });

  const starts = [];
  for (const stretch of stretches) {
    // Una clase de 13:00 a 13:45 deja libre desde 13:45: el primer inicio es 14:00.
    for (
      let start = firstStartFrom(stretch.from, cutoff);
      start + MIN_CLASS_MINUTES <= stretch.to;
      start += STEP_MINUTES
    ) {
      // FILTRO: un inicio que cae dentro de una clase propia del alumno no se
      // manda; uno que no deja ni la clase mínima antes de la próxima suya, tampoco.
      if (own.some((span) => span.from <= start && start < span.to)) continue;
      let limit = stretch.to;
      for (const span of own) if (span.from > start) limit = Math.min(limit, span.from);
      const maxMinutes = Math.floor((limit - start) / DURATION_STEP) * DURATION_STEP;
      if (maxMinutes >= MIN_CLASS_MINUTES) starts.push({ start: toTime(start), maxMinutes });
    }
  }

  return { starts, groups };
}

/**
 * ¿Le queda a la ventana algún inicio que no pasó? Para las de licencia de
 * hoy, que no tienen `starts` con qué medirlo.
 */
function hasFutureStart(window, cutoff) {
  if (cutoff === null) return true;
  return firstStartFrom(toMinutes(window.start), cutoff) + MIN_CLASS_MINUTES <= toMinutes(window.end);
}

/**
 * Lo que contesta GET /api/availability: las ventanas proyectadas sobre las
 * fechas del rango y recortadas a lo que ESTE usuario puede reservar. Es el
 * único lugar que decide qué se ve en el tablero del alumno; la ruta solo lee
 * de la base y llama a esto.
 *
 * Dos sentidos distintos de "reservado", y los dos se descuentan:
 *  - Reservado CON ESE DOCENTE: ese rato deja de existir para todos (salvo
 *    el lugar que quede en una grupal).
 *  - Reservado por el alumno con CUALQUIER docente (`studentLessons`): el
 *    rato del docente sigue existiendo para otros, pero a este alumno no se
 *    le ofrece (corta los `maxMinutes` y saca los inicios y grupales que se pisan).
 *
 * El link de las virtuales y la dirección exacta de las presenciales no
 * salen: se los lleva el alumno recién al reservar. Para decidir alcanza con
 * la localidad.
 *
 * Una ventana que cae en licencia de su docente NO desaparece: sale con
 * `onVacation: true` y sin nada reservable, para que el alumno la vea en gris
 * y sepa por qué (y no crea que el docente dejó de dar esa clase).
 *
 * @param {object} args
 * @param {Array<object>} args.windows - findPublishedWindows (db/availability.js):
 *   ya trae solo docentes aprobados y ventanas con alguna tarifa en su
 *   modalidad (ese filtro vive en el SQL, no se repite acá), con `subjects` y
 *   `teacherFeatured`.
 * @param {Array<object>} args.taken - findTakenSlots (db/classes.js): un elemento por
 *   turno ({ teacherId, date, start, end, subjectId, subjectName, enrolled,
 *   maxStudents, modality }).
 * @param {Array<object>} [args.vacations] - listVacationsInRange (db/vacations.js).
 * @param {Array<object>} [args.studentLessons] - las clases no canceladas del
 *   alumno en el rango (findClassesForUser de db/classes.js); [] si quien mira
 *   no es alumno.
 * @param {object|null} [args.rescheduling] - la clase confirmada que se está
 *   reprogramando (`?excludeClassId=`), o null.
 * @param {string|null} [args.viewerId] - request.user.id: nadie se ofrece a sí mismo.
 * @param {string} args.from - request.query.from, ya validado con dateRangeProblem.
 * @param {string} args.to - request.query.to, inclusive.
 * @param {{iso: string, time: string}} [args.now] - now() de lib/clock.js.
 * @returns {Array<object>} filas { id: '<windowId>|<fecha>', windowId, date, dayKey,
 *   teacherId, teacherName, teacherAcceptsRewards, teacherFeatured, start, end,
 *   modality, maxStudents, locality, subjects, starts, groups, onVacation }.
 * Lo usa: routes/availability/index.js.
 */
export function bookableRows({
  windows,
  taken,
  vacations = [],
  studentLessons = [],
  rescheduling = null,
  viewerId = null,
  from,
  to,
  now = null,
}) {
  // Al reprogramar, la clase vieja no ocupa su horario ni cuenta como clase
  // propia: se cancela en la misma transacción que crea la nueva.
  const turns = rescheduling ? withoutClass(taken, rescheduling) : taken;
  const lessons = studentLessons.filter(
    (lesson) =>
      lesson.status !== 'cancelada' &&
      !(rescheduling && String(lesson.id) === String(rescheduling.id))
  );

  const takenByTeacherDate = new Map();
  for (const group of turns) {
    const key = `${group.teacherId}|${group.date}`;
    if (!takenByTeacherDate.has(key)) takenByTeacherDate.set(key, []);
    takenByTeacherDate.get(key).push(group);
  }

  const rows = [];

  for (const iso of datesBetween(from, to)) {
    // FILTRO: un día entero ya pasado no aporta nada.
    if (now && iso < now.iso) continue;
    const cutoff = now && iso === now.iso ? toMinutes(now.time) : null;
    const own = lessonSpans(lessons, iso);

    for (const window of windows) {
      if (!occursOn(window, iso)) continue;
      // FILTRO: el docente logueado no se ofrece a sí mismo.
      if (viewerId !== null && String(window.teacherId) === String(viewerId)) continue;
      // FILTRO: al reprogramar, solo el mismo docente y la misma materia (es
      // lo que acepta POST /api/classes/:id/reschedule): lo demás no le sirve.
      if (rescheduling && String(window.teacherId) !== String(rescheduling.teacherId)) continue;
      const subjects = rescheduling
        ? window.subjects.filter((s) => String(s.id) === String(rescheduling.subjectId))
        : window.subjects;
      if (subjects.length === 0) continue;

      const onVacation = VacationRange.covers(vacations, iso, window.teacherId);
      let starts = [];
      let groups = [];
      if (onVacation) {
        // FILTRO: la de licencia sale en gris, salvo la de hoy que ya terminó
        // (o no le queda ningún inicio): esa ya no le dice nada al alumno.
        if (!hasFutureStart(window, cutoff)) continue;
      } else {
        const busy = takenByTeacherDate.get(`${window.teacherId}|${iso}`) ?? [];
        ({ starts, groups } = openingsForWindow({ ...window, subjects }, busy, { cutoff, own }));
        if (rescheduling) {
          groups = groups.filter((g) => String(g.subjectId) === String(rescheduling.subjectId));
        }
        // FILTRO: "que lo completo no aparezca": sin inicio ni grupal posible
        // para este alumno, la fila no sale.
        if (starts.length === 0 && groups.length === 0) continue;
      }

      rows.push({
        id: `${window.id}|${iso}`,
        windowId: window.id,
        date: iso,
        dayKey: dayKeyFromIso(iso),
        teacherId: window.teacherId,
        teacherName: window.teacherName,
        teacherAcceptsRewards: Boolean(window.teacherAcceptsRewards),
        // De licencia no se destaca: no tiene nada para ofrecer.
        teacherFeatured: Boolean(window.teacherFeatured) && !onVacation,
        start: window.start,
        end: window.end,
        modality: window.modality,
        maxStudents: window.maxStudents,
        locality: window.locality ?? null,
        subjects,
        starts,
        groups,
        onVacation,
      });
    }
  }

  return rows;
}

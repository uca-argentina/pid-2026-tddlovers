// El puente entre las ventanas que carga el docente y las fechas que reserva
// el alumno (ver CLAUDE.md, "weekly template → dated availability"). Una
// ventana tiene una fecha y puede repetirse todas las semanas; acá se
// proyecta sobre el rango pedido y se resta lo ya reservado.
//
// Todo se hace en minutos desde medianoche: comparar 'HH:MM' como texto
// funciona de casualidad y se rompe con '24:00'.

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
const MIN_CLASS_MINUTES = 30;

export function toMinutes(time) {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' -> 'lunes'. getUTCDay: 0 es domingo y la semana arranca lunes. */
export function dayKeyFromIso(iso) {
  const date = new Date(`${iso}T00:00:00Z`);
  return DAY_KEYS[(date.getUTCDay() + 6) % 7];
}

/** Cada fecha del rango, inclusive los dos extremos. */
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
 */
export function occursOn(window, iso) {
  if (iso === window.date) return true;
  return (
    window.repeatsWeekly && iso > window.date && dayKeyFromIso(iso) === dayKeyFromIso(window.date)
  );
}

/**
 * Lo que el alumno puede hacer en UNA ocurrencia de una ventana:
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
 * `taken` son las clases del docente ese día, agrupadas por turno.
 * `cutoff` (minutos) descarta lo que ya empezó; null si el día es futuro.
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
      const joinable =
        from >= winFrom &&
        from < winTo &&
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
 * Proyecta las ventanas sobre las fechas del rango. Devuelve una fila por
 * (ventana, fecha) con lo que queda para reservar; las que se quedan sin
 * nada no salen.
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
 */
export function expandAvailability({ windows, taken, from, to, nowIso, nowTime }) {
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

      const busy = takenByTeacherDate.get(`${window.teacherId}|${iso}`) ?? [];
      const { free, groups } = openingsForWindow(window, busy, cutoff);
      if (free.length === 0 && groups.length === 0) continue;

      rows.push({
        id: `${window.id}|${iso}`,
        windowId: window.id,
        date: iso,
        dayKey: dayKeyFromIso(iso),
        teacherId: window.teacherId,
        teacherName: window.teacherName,
        start: window.start,
        end: window.end,
        modality: window.modality,
        maxStudents: window.maxStudents,
        locality: window.locality ?? null,
        subjects: window.subjects,
        free,
        groups,
      });
    }
  }

  return rows;
}

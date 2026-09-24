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

// Los arranques van de a media hora; los finales, donde caiga la duración.
const STEP_MINUTES = 30;

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

function overlaps(fromA, toA, fromB, toB) {
  return fromA < toB && fromB < toA;
}

/**
 * Los turnos que el alumno puede tomar en UNA ocurrencia de una ventana:
 *
 *  - Sumarse a una clase grupal que ya arrancó alguien, mientras quede cupo.
 *    Es la misma hora y la misma materia; `enrolled` dice cuántos hay.
 *  - Arrancar una clase nueva en cualquier :00/:30 donde entre la duración
 *    entera sin pisar ninguna clase del docente (de esta ventana o de otra:
 *    el docente no da dos clases a la vez). La duración es libre, así que el
 *    fin puede caer en cualquier minuto: 13:00 + 45 min termina 13:45.
 *
 * `taken` son las clases del docente ese día, agrupadas por turno.
 * `cutoff` (minutos) descarta lo que ya empezó; null si el día es futuro.
 */
export function slotsForWindow(window, taken, cutoff = null) {
  const winFrom = toMinutes(window.start);
  const winTo = toMinutes(window.end);
  const alreadyStarted = (minutes) => cutoff !== null && minutes <= cutoff;

  const slots = [];

  if (window.maxStudents > 1) {
    for (const group of taken) {
      const from = toMinutes(group.start);
      const joinable =
        from >= winFrom &&
        from < winTo &&
        // Si el docente cambió la materia de la ventana, un grupo armado con
        // la materia vieja no es la clase que la ventana ofrece ahora.
        String(group.subjectId) === String(window.subjectId) &&
        group.enrolled < window.maxStudents &&
        !alreadyStarted(from);
      if (joinable) slots.push({ start: group.start, end: group.end, enrolled: group.enrolled });
    }
  }

  for (let from = winFrom; from + window.durationMinutes <= winTo; from += STEP_MINUTES) {
    if (alreadyStarted(from)) continue;
    const to = from + window.durationMinutes;
    const clashes = taken.some((group) =>
      overlaps(from, to, toMinutes(group.start), toMinutes(group.end))
    );
    if (!clashes) slots.push({ start: toTime(from), end: toTime(to), enrolled: 0 });
  }

  return slots.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

/**
 * Proyecta las ventanas sobre las fechas del rango. Devuelve una fila por
 * (ventana, fecha) con los turnos que quedan; las que se quedan sin ninguno
 * no salen.
 *
 * Dos sentidos distintos de "reservado", y solo uno se resta:
 *  - Reservado CON ESE DOCENTE: ese rato deja de existir para todos (salvo
 *    el lugar que quede en una grupal), así que se resta.
 *  - Reservado por el alumno con OTRO docente: el turno del docente sigue
 *    existiendo, este alumno no puede tomarlo. NO se resta acá — el front lo
 *    pinta en gris con lo que devuelve /api/classes.
 *
 * `taken`: [{ teacherId, date, start, end, subjectId, enrolled }], un
 * elemento por turno (una grupal con 3 alumnos es UNO con enrolled 3).
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

      const busy = takenByTeacherDate.get(`${window.teacherId}|${iso}`) ?? [];
      const slots = slotsForWindow(window, busy, cutoff);
      if (slots.length === 0) continue;

      rows.push({
        id: `${window.id}|${iso}`,
        windowId: window.id,
        date: iso,
        dayKey: dayKeyFromIso(iso),
        teacherId: window.teacherId,
        teacherName: window.teacherName,
        subject: { id: window.subjectId, name: window.subjectName },
        start: window.start,
        end: window.end,
        durationMinutes: window.durationMinutes,
        price: window.price,
        modality: window.modality,
        maxStudents: window.maxStudents,
        locality: window.locality ?? null,
        slots,
      });
    }
  }

  return rows;
}

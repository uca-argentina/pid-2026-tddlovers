// El puente entre la plantilla semanal del docente y las fechas que reserva
// el alumno. Esta es la pieza que el front tenía en utils/booking.js contra
// los mocks y que siempre estuvo pensada para vivir acá (ver
// PID-Front/CLAUDE.md, "weekly template → dated availability").
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
 * Los pedazos de `ranges` que no toca ninguno de `busy`. Un hueco en el medio
 * parte un rango en dos; si lo tapan entero, desaparece.
 *
 * Tocarse en el borde NO es pisarse: 14:00-15:00 y 15:00-16:00 conviven.
 */
export function subtractRanges(ranges, busy) {
  let spans = ranges.map((r) => ({ from: toMinutes(r.start), to: toMinutes(r.end) }));

  for (const b of busy) {
    const taken = { from: toMinutes(b.start), to: toMinutes(b.end) };
    const next = [];
    for (const span of spans) {
      if (taken.to <= span.from || taken.from >= span.to) {
        next.push(span);
        continue;
      }
      if (span.from < taken.from) next.push({ from: span.from, to: taken.from });
      if (taken.to < span.to) next.push({ from: taken.to, to: span.to });
    }
    spans = next;
  }

  return spans
    .sort((a, b) => a.from - b.from)
    .map((s) => ({ start: toTime(s.from), end: toTime(s.to) }));
}

/** ¿Entra una clase de 1 h? Un resto de media hora no sirve para nada. */
function fitsAClass(range) {
  return toMinutes(range.end) - toMinutes(range.start) >= 60;
}

/**
 * Proyecta las plantillas semanales sobre las fechas del rango y resta lo ya
 * reservado. Devuelve una fila por (docente, fecha) con los rangos libres de
 * ese día y las materias del docente — la materia no es parte del horario, la
 * elige el alumno al reservar.
 *
 * Dos sentidos distintos de "reservado", y solo uno se resta:
 *  - Reservado CON ESE DOCENTE: la hora deja de existir para todos, así que
 *    se resta, sea de la materia que sea.
 *  - Reservado por el alumno con OTRO docente: la hora del docente sigue
 *    existiendo, este alumno no puede tomarla. NO se resta acá — el front la
 *    pinta en gris con lo que devuelve /api/classes.
 *
 * `nowIso`/`nowTime` recortan lo que ya pasó: una hora de hoy que ya arrancó
 * no se ofrece más.
 */
export function expandAvailability({ entries, bookings, from, to, nowIso, nowTime }) {
  const bookingsByTeacherDate = new Map();
  for (const b of bookings) {
    const key = `${b.teacherId}|${b.date}`;
    if (!bookingsByTeacherDate.has(key)) bookingsByTeacherDate.set(key, []);
    bookingsByTeacherDate.get(key).push({ start: b.start, end: b.end });
  }

  const rows = [];

  for (const iso of datesBetween(from, to)) {
    // Un día entero ya pasado no aporta nada.
    if (nowIso && iso < nowIso) continue;
    const dayKey = dayKeyFromIso(iso);

    for (const entry of entries) {
      const ranges = entry.schedule[dayKey];
      if (!ranges || ranges.length === 0) continue;

      const busy = bookingsByTeacherDate.get(`${entry.teacherId}|${iso}`) ?? [];
      let free = subtractRanges(ranges, busy);

      // Hoy: se corta lo que ya empezó. Se deja el rango que todavía permite
      // arrancar una clase completa más adelante.
      if (nowIso && iso === nowIso && nowTime) {
        const cutoff = toMinutes(nowTime);
        free = free
          .map((r) => {
            const start = Math.max(toMinutes(r.start), cutoff);
            return { start: toTime(start), end: r.end };
          })
          .filter((r) => toMinutes(r.start) < toMinutes(r.end));
      }

      free = free.filter(fitsAClass);
      if (free.length === 0) continue;

      rows.push({
        id: `${iso}|${entry.teacherId}`,
        date: iso,
        dayKey,
        teacherId: entry.teacherId,
        teacherName: entry.teacherName,
        subjects: entry.subjects,
        ranges: free,
      });
    }
  }

  return rows;
}

// Valida la plantilla semanal que manda el scheduler. La UI ya valida todo
// esto, pero la UI se puede saltear: acá se vuelve a chequear antes de tocar
// la base. Los CHECK de la tabla son la última red, pero un error de
// constraint no se le puede mostrar a nadie.

const DAY_KEYS = new Set([
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
]);

// 'HH:MM' en :00 o :30. Se acepta '24:00' como fin del día — una ventana que
// llega hasta medianoche NO se escribe '00:00', porque rompería start < end.
const TIME_RE = /^(?:[01]\d|2[0-3]):(?:00|30)$/;

function toMinutes(time) {
  if (time === '24:00') return 24 * 60;
  if (!TIME_RE.test(time)) return null;
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

/**
 * Devuelve un mensaje en español si algo está mal, o null si la plantilla
 * sirve. Un solo mensaje y no una lista: la pantalla muestra uno.
 */
export function validateSchedule(schedule) {
  if (!schedule || typeof schedule !== 'object' || Array.isArray(schedule)) {
    return 'La disponibilidad tiene un formato inválido.';
  }

  for (const [dayKey, ranges] of Object.entries(schedule)) {
    if (!DAY_KEYS.has(dayKey)) {
      return `"${dayKey}" no es un día válido.`;
    }
    if (!Array.isArray(ranges)) {
      return `Los horarios de ${dayKey} tienen un formato inválido.`;
    }

    const spans = [];
    for (const range of ranges) {
      const start = toMinutes(range?.start);
      const end = toMinutes(range?.end);

      if (start === null || end === null) {
        return `Hay un horario inválido en ${dayKey}: solo se puede empezar y terminar en punto o y media.`;
      }
      if (start >= end) {
        return `Hay un horario al revés en ${dayKey}.`;
      }
      // La regla del modelo: adentro de la ventana tiene que entrar una clase.
      if (end - start < 60) {
        return `Hay un bloque de menos de una hora en ${dayKey}: no entra una clase.`;
      }
      spans.push([start, end]);
    }

    // Rangos pisados en el mismo día. Tocarse en el borde NO es pisarse:
    // 14:00-15:00 y 15:00-16:00 conviven bien.
    spans.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < spans.length; i += 1) {
      if (spans[i][0] < spans[i - 1][1]) {
        return `Hay horarios superpuestos en ${dayKey}.`;
      }
    }
  }

  return null;
}

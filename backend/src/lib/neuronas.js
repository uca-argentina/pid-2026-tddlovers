// Las reglas de las neuronas: qué suma, cuánto, y qué cuesta cada premio.
// Funciones puras, como bookingStates.js, para probarlas sin reloj ni base.
// Espejadas en frontend/src/utils/neuronas.js solo para mostrar: la que vale es
// esta. Los números son valores iniciales para ajustar con el uso.
//
// Tablas: neurona_credits, teacher_featured, class_bookings.reward_type /
// reward_neuronas (migración 021; class_bookings desde la 023). El saldo nunca se guarda: lo suma
// db/neuronas.js.
// Lo usan: db/neuronas.js (topes, weekClassCredits, homeworkEarns...),
// routes/bookings/index.js (REWARDS, rewardProblem), routes/homework/index.js
// (correctionCredits), routes/neuronas/index.js (levelFor, badgesFor,
// Destacado) y lib/teacherRates.js (rewardPriceCents).

import { now as clockNow } from './clock.js';
import { classPriceCents } from './teacherRates.js';
import { toEpochMinutes } from './bookingStates.js';

// Canjes que el alumno elige al reservar (body.rewardType) y su costo en
// neuronas: free_30 (500), free_60 (1000), discount_10 (250), discount_20 (500).
// Espejo: frontend/src/utils/neuronas.js (REWARDS): cambiar los costos en los dos.
export const REWARDS = {
  free_30: { kind: 'free', minutes: 30, cost: 500 },
  free_60: { kind: 'free', minutes: 60, cost: 1000 },
  discount_10: { kind: 'discount', percent: 10, cost: 250 },
  discount_20: { kind: 'discount', percent: 20, cost: 500 },
};

// "Destacado" del docente: 7 días desde hoy por 1000 neuronas, como mucho 5
// docentes activos a la vez (CLAUDE.md, "Spending").
export const FEATURED_COST = 1000;
export const FEATURED_DAYS = 7;
export const MAX_FEATURED_TEACHERS = 5;

// Ganancia por clases (CLAUDE.md, "Earning"): 10/h proporcional; el docente
// suma 0,5 por cada alumno extra contado (hasta 10 alumnos); una pareja
// docente–alumno cuenta hasta 8 h por semana (lunes a domingo); el docente
// suma como mucho 150 por fecha de clase.
const NEURONAS_PER_HOUR = 10;
const EXTRA_STUDENT_FACTOR = 0.5;
const MAX_COUNTED_STUDENTS = 10;
const PAIR_WEEKLY_MINUTES = 8 * 60;
export const TEACHER_CLASS_DAILY_CAP = 150;

// Tareas: el alumno suma 10 por entrega a tiempo (máx. 3 por semana por
// docente); el docente suma por corregir, máx. 50 por día y solo con
// devoluciones de ≥20 caracteres; una tarea con <24 h entre creación y
// vencimiento no le da nada a nadie.
export const HOMEWORK_ON_TIME_NEURONAS = 10;
export const HOMEWORK_WEEKLY_CAP_PER_TEACHER = 3;
export const FEEDBACK_DAILY_CAP = 50;
const MIN_FEEDBACK_LENGTH = 20;
const MIN_HOMEWORK_LEAD_MINUTES = 24 * 60;

const HOUR = 60;
// Primera corrección: 10 si llega antes de 24 h, 6 hasta 72 h, 3 hasta 168 h,
// 0 después (contando desde lo último entre la entrega y el vencimiento).
const FEEDBACK_TIERS = [
  { under: 24 * HOUR, neuronas: 10 },
  { under: 72 * HOUR, neuronas: 6 },
  { under: 168 * HOUR, neuronas: 3 },
];

// Niveles por neuronas acreditadas en total (CLAUDE.md, "Level").
const LEVELS = [
  { name: 'Neurona', min: 0 },
  { name: 'Sinapsis', min: 200 },
  { name: 'Red neuronal', min: 600 },
  { name: 'Mente brillante', min: 1500 },
];

/**
 * Si la clase cuenta para el docente. No alcanza con mirar paidAt: aceptar una
 * clase cubierta por un paquete de $ 0 también lo completa, y una clase gratis
 * se puede marcar como paga por la API. Por eso las de precio 0 se deciden
 * según qué las cubre: si no, un docente con tarifa $ 0 y una cuenta falsa
 * sumaría sin límite. `packPriceCents` es el precio del paquete de la reserva.
 *
 * @param {object} booking - una reserva como la lee syncClassCredits (db/neuronas.js):
 *   { status, priceCents, paidAt, rewardType, packPriceCents (de student_packs) }.
 * @returns {boolean}
 * Lo usan: este archivo (countsForStudent, classCredits).
 */
export function countsForTeacher(booking) {
  if (booking.status !== 'realizada') return false;
  if (booking.priceCents > 0) return Boolean(booking.paidAt);
  return Boolean(booking.rewardType) || booking.packPriceCents > 0;
}

/**
 * Si la clase le da neuronas al alumno: cuenta para el docente y no se pagó
 * con un canje (si no, se encadenarían clases gratis). Solo se usa acá.
 */
export function countsForStudent(booking) {
  return countsForTeacher(booking) && !booking.rewardType;
}

function bookingMinutes(booking) {
  return toEpochMinutes(booking.date, booking.endTime) - toEpochMinutes(booking.date, booking.startTime);
}

/**
 * Los minutos de esta clase que entran en el límite semanal de la pareja, dado
 * cuántos ya contaron antes en esa semana. Acota lo que se puede farmear entre
 * un docente y una cuenta falsa.
 * @returns {number} minutos que cuentan (0 si ya se llegó a las 8 h). Solo se usa acá.
 */
export function minutesWithinPairLimit(minutes, previousMinutes) {
  return Math.max(0, Math.min(minutes, PAIR_WEEKLY_MINUTES - previousMinutes));
}

/** Neuronas del alumno por `minutes` contados de clase (10/h, redondeado). Solo se usa acá. */
export function studentClassCredit(minutes) {
  return Math.round((NEURONAS_PER_HOUR * minutes) / HOUR);
}

/**
 * Lo que suma el docente por una clase, según los minutos que contaron de cada
 * presente. El primero vale entero y los demás la mitad: premia al grupo sin
 * que una clase de 50 valga 50 individuales, que desalentaría dar individuales.
 * @param {number[]} studentMinutes - minutos contados de cada reserva de la clase.
 * @returns {number} neuronas del docente por la clase, antes del tope diario. Solo se usa acá.
 */
export function teacherClassCredit(studentMinutes) {
  const [first = 0, ...rest] = [...studentMinutes]
    .filter((minutes) => minutes > 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_COUNTED_STUDENTS);
  const extra = rest.reduce((sum, minutes) => sum + minutes, 0);
  return Math.round((NEURONAS_PER_HOUR * (first + EXTRA_STUDENT_FACTOR * extra)) / HOUR);
}

/**
 * El lunes y el domingo de la semana de esa fecha.
 * @param {string} iso - 'YYYY-MM-DD'.
 * @returns {{monday: string, sunday: string}}
 * Lo usa: db/neuronas.js (syncClassCredits y el tope semanal de tareas).
 */
export function weekBounds(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const fromMonday = (date.getUTCDay() + 6) % 7;
  const day = (offset) =>
    new Date(Date.UTC(y, m - 1, d - fromMonday + offset)).toISOString().slice(0, 10);
  return { monday: day(0), sunday: day(6) };
}

const startsBefore = (a, b) => `${a.date}T${a.startTime}` < `${b.date}T${b.startTime}`;

/**
 * Lo que le corresponde a cada reserva de una clase y al docente. `weekRows` son
 * las clases realizadas de ese docente en la semana. Se recalcula todo desde el
 * estado actual, y por eso corregir una asistencia revierte sus neuronas sin
 * deshacer nada. El límite mira solo las clases anteriores para que el resultado
 * no dependa del orden en que el docente tomó lista.
 *
 * @param {Array<object>} classRows - las reservas de una clase (filas de syncClassCredits).
 * @param {Array<object>} weekRows - todas las filas de la semana del docente.
 * @returns {{bookings: Array<{bookingId, studentId, minutes, student, bonus}>, teacher: number}}
 * Lo usa: weekClassCredits (este archivo).
 */
export function classCredits(classRows, weekRows) {
  const bookings = classRows.map((row) => {
    const counts = countsForTeacher(row);
    const previous = weekRows
      .filter(
        (other) =>
          String(other.studentId) === String(row.studentId) &&
          countsForTeacher(other) &&
          startsBefore(other, row)
      )
      .reduce((sum, other) => sum + bookingMinutes(other), 0);
    const minutes = counts ? minutesWithinPairLimit(bookingMinutes(row), previous) : 0;
    return {
      bookingId: row.id,
      studentId: row.studentId,
      minutes,
      student: countsForStudent(row) ? studentClassCredit(minutes) : 0,
      bonus: counts && row.rewardType ? rewardBonus(row.rewardNeuronas) : 0,
    };
  });
  return { bookings, teacher: teacherClassCredit(bookings.map((row) => row.minutes)) };
}

/**
 * Lo que entra de `amount` en un tope, dado lo que ya se sumó.
 * @returns {number} entre 0 y `amount`.
 * Lo usan: weekClassCredits y db/neuronas.js (tope diario de correcciones).
 */
export function withinCap(amount, cap, alreadyEarned) {
  return Math.max(0, Math.min(amount, cap - alreadyEarned));
}

/**
 * Las neuronas de todas las clases de un docente en una semana, desde cero.
 * `weekRows` son sus reservas realizadas de la semana más las reservas (en
 * cualquier estado) de la clase que hay que poner en cero. Los dos topes se
 * aplican en orden cronológico: el de 8 h por pareja mira las clases anteriores
 * y el de 150 por fecha, las clases anteriores de ese día. Así el total no
 * depende del orden en que se tomó lista o se pagó, y cambiar una clase solo
 * puede mover a las que vienen después: es lo que le permite a
 * syncClassCredits recalcular solo esas.
 * Devuelve las clases en orden: [{ classId, date, startTime, rows, bookings, teacher }].
 *
 * @param {Array<object>} weekRows - la consulta de syncClassCredits (db/neuronas.js):
 *   class_bookings JOIN classes JOIN subjects LEFT JOIN student_packs de la semana del docente,
 *   cada fila con su `classId`.
 * Lo usa: db/neuronas.js (syncClassCredits, que guarda el resultado en neurona_credits).
 */
export function weekClassCredits(weekRows) {
  const classes = new Map();
  for (const row of weekRows) {
    if (!classes.has(row.classId)) {
      classes.set(row.classId, {
        classId: row.classId,
        date: row.date,
        startTime: row.startTime,
        rows: [],
      });
    }
    classes.get(row.classId).rows.push(row);
  }
  const ordered = [...classes.values()].sort((a, b) =>
    `${a.date}T${a.startTime}`.localeCompare(`${b.date}T${b.startTime}`)
  );
  const earnedByDate = new Map();
  return ordered.map((cls) => {
    const credits = classCredits(cls.rows, weekRows);
    const earned = earnedByDate.get(cls.date) ?? 0;
    const teacher = withinCap(credits.teacher, TEACHER_CLASS_DAILY_CAP, earned);
    earnedByDate.set(cls.date, earned + teacher);
    return { ...cls, bookings: credits.bookings, teacher };
  });
}

/**
 * El bono del docente por dar una clase canjeada: la mitad de lo que gastó el
 * alumno (class_bookings.reward_neuronas), sin tope. Solo se usa acá (classCredits).
 */
export function rewardBonus(rewardNeuronas) {
  return Math.floor(rewardNeuronas / 2);
}

// Un timestamp de la base (created_at, submitted_at) en minutos, en hora argentina.
function epochOf(timestamp) {
  const { iso, time } = clockNow(new Date(timestamp));
  return toEpochMinutes(iso, time);
}

/**
 * Con menos de 24 h para hacerla no da neuronas: frena tareas armadas solo para sumar.
 * @param {{createdAt, dueDate: string, dueTime: string}} homework - de la tabla homeworks.
 * @returns {boolean}
 * Lo usan: correctionCredits y db/neuronas.js (settleHomeworkCredits).
 * Espejo: frontend/src/utils/neuronas.js (homeworkEarns).
 */
export function homeworkEarns({ createdAt, dueDate, dueTime }) {
  return toEpochMinutes(dueDate, dueTime) - epochOf(createdAt) >= MIN_HOMEWORK_LEAD_MINUTES;
}

/**
 * Neuronas por la velocidad de la devolución. El reloj arranca en lo último
 * entre la última edición y el vencimiento: corregir cierra la entrega, y si
 * corriera desde antes del vencimiento premiaría sacarle tiempo al alumno y
 * castigaría corregir todo el grupo junto al cerrar el plazo.
 * @param {{submittedAt, dueDate: string, dueTime: string}} submission
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 * @returns {number} 10, 6, 3 o 0. Solo se usa acá (correctionCredits).
 */
export function feedbackCredit({ submittedAt, dueDate, dueTime }, now) {
  const clockStart = Math.max(epochOf(submittedAt), toEpochMinutes(dueDate, dueTime));
  const elapsed = toEpochMinutes(now.iso, now.time) - clockStart;
  return FEEDBACK_TIERS.find((tier) => elapsed < tier.under)?.neuronas ?? 0;
}

/**
 * Lo que da la PRIMERA corrección de una entrega, antes de los topes. El alumno
 * no pierde sus neuronas si la devolución es corta: eso es decisión del docente.
 *
 * @param {object} submission - la entrega con datos de la tarea (submittedAt,
 *   isLate, createdAt, dueDate, dueTime), como la lee db/homework.js.
 * @param {string} feedback - la devolución ya validada (validateFeedback).
 * @param {{iso: string, time: string}} now - now() de lib/clock.js.
 * @returns {{teacher: number, student: number}} se acredita después con
 *   creditCorrection (db/neuronas.js), que aplica los topes.
 * Lo usa: routes/homework/index.js (POST .../feedback, solo en la primera corrección).
 */
export function correctionCredits(submission, feedback, now) {
  if (!homeworkEarns(submission)) return { teacher: 0, student: 0 };
  return {
    teacher: feedback.length >= MIN_FEEDBACK_LENGTH ? feedbackCredit(submission, now) : 0,
    student: submission.isLate ? 0 : HOMEWORK_ON_TIME_NEURONAS,
  };
}

/**
 * Null si el canje se puede usar en esta clase; si no, el motivo. Un canje que
 * cubre más de lo que dura la clase se rechaza, igual que con los paquetes.
 *
 * @param {string} rewardType - body.rewardType, ya validado contra REWARDS.
 * @param {{hourlyRateCents: number, minutes: number}} args - la tarifa (findRate,
 *   db/rates.js) y body.durationMinutes.
 * @returns {string|null}
 * Lo usa: routes/bookings/index.js (priceBooking).
 */
export function rewardProblem(rewardType, { hourlyRateCents, minutes }) {
  const reward = REWARDS[rewardType];
  if (hourlyRateCents <= 0) return 'Esta clase ya es gratis: no hace falta usar neuronas.';
  if (reward.kind === 'free' && minutes < reward.minutes) {
    return `Este canje cubre ${reward.minutes} minutos: elegí una clase de esa duración o más.`;
  }
  return null;
}

/**
 * Lo que queda por pagar con el canje. El descuento se aplica sobre los
 * primeros 60 minutos: sin ese límite, el mismo costo valdría más cuanto más
 * larga la clase.
 *
 * @param {string} rewardType - clave de REWARDS.
 * @param {{hourlyRateCents: number, minutes: number}} args
 * @returns {number} centavos a pagar (classes.price_cents).
 * Lo usa: lib/teacherRates.js (bookingPriceCents).
 * Espejo: frontend/src/utils/neuronas.js (rewardPriceCents).
 */
export function rewardPriceCents(rewardType, { hourlyRateCents, minutes }) {
  const reward = REWARDS[rewardType];
  if (reward.kind === 'free') {
    return classPriceCents(hourlyRateCents, minutes - reward.minutes);
  }
  const base = classPriceCents(hourlyRateCents, Math.min(minutes, HOUR));
  return classPriceCents(hourlyRateCents, minutes) - Math.round((base * reward.percent) / 100);
}

/**
 * El nivel sale de lo acreditado en total, así que gastar neuronas no lo baja.
 * @param {number} earned - Σ neurona_credits del usuario (findBalance, db/neuronas.js).
 * @returns {{name, min, nextName, nextMin}} nextName/nextMin null en el último nivel.
 * Lo usa: routes/neuronas/index.js (GET /api/neuronas).
 * Espejo: frontend/src/utils/neuronas.js (levelProgress, para la barra).
 */
export function levelFor(earned) {
  const index = LEVELS.findLastIndex((level) => earned >= level.min);
  const next = LEVELS[index + 1] ?? null;
  return {
    name: LEVELS[index].name,
    min: LEVELS[index].min,
    nextName: next?.name ?? null,
    nextMin: next?.min ?? null,
  };
}

/**
 * Las insignias del alumno, calculadas de sus conteos de créditos.
 * @param {{classesAttended: number, homeworksOnTime: number}} counts - findCreditCounts (db/neuronas.js).
 * @returns {Array<{key, label, earned}>}
 * Lo usa: routes/neuronas/index.js (solo para alumnos).
 */
export function badgesFor({ classesAttended, homeworksOnTime }) {
  return [
    { key: 'first_class', label: 'Primera clase', earned: classesAttended >= 1 },
    { key: 'ten_classes', label: '10 clases', earned: classesAttended >= 10 },
    { key: 'five_homeworks', label: '5 tareas a tiempo', earned: homeworksOnTime >= 5 },
  ];
}

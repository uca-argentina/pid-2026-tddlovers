// Las reglas de las neuronas: qué suma, cuánto, y qué cuesta cada premio.
// Funciones puras, como classStates.js, para probarlas sin reloj ni base.
// Espejadas en frontend/src/utils/neuronas.js solo para mostrar: la que vale es
// esta. Los números son valores iniciales para ajustar con el uso.

import { now as clockNow } from './clock.js';
import { classPriceCents } from './teacherRates.js';
import { toEpochMinutes } from './classStates.js';

export const REWARDS = {
  free_30: { kind: 'free', minutes: 30, cost: 500 },
  free_60: { kind: 'free', minutes: 60, cost: 1000 },
  discount_10: { kind: 'discount', percent: 10, cost: 250 },
  discount_20: { kind: 'discount', percent: 20, cost: 500 },
};

export const FEATURED_COST = 1000;
export const FEATURED_DAYS = 7;
export const MAX_FEATURED_TEACHERS = 5;

const NEURONAS_PER_HOUR = 10;
const EXTRA_STUDENT_FACTOR = 0.5;
const MAX_COUNTED_STUDENTS = 10;
export const PAIR_WEEKLY_MINUTES = 8 * 60;
export const TEACHER_CLASS_DAILY_CAP = 150;

export const HOMEWORK_ON_TIME_NEURONAS = 10;
export const HOMEWORK_WEEKLY_CAP_PER_TEACHER = 3;
export const FEEDBACK_DAILY_CAP = 50;
export const MIN_FEEDBACK_LENGTH = 20;
const MIN_HOMEWORK_LEAD_MINUTES = 24 * 60;

const HOUR = 60;
const FEEDBACK_TIERS = [
  { under: 24 * HOUR, neuronas: 10 },
  { under: 72 * HOUR, neuronas: 6 },
  { under: 168 * HOUR, neuronas: 3 },
];

export const LEVELS = [
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
 */
export function countsForTeacher(cls) {
  if (cls.status !== 'realizada') return false;
  if (cls.priceCents > 0) return Boolean(cls.paidAt);
  return Boolean(cls.rewardType) || cls.packPriceCents > 0;
}

/** Un canje no vuelve a dar neuronas al alumno: si no, se encadenarían clases gratis. */
export function countsForStudent(cls) {
  return countsForTeacher(cls) && !cls.rewardType;
}

export function classMinutes(cls) {
  return toEpochMinutes(cls.date, cls.endTime) - toEpochMinutes(cls.date, cls.startTime);
}

/**
 * Los minutos de esta clase que entran en el límite semanal de la pareja, dado
 * cuántos ya contaron antes en esa semana. Acota lo que se puede farmear entre
 * un docente y una cuenta falsa.
 */
export function minutesWithinPairLimit(minutes, previousMinutes) {
  return Math.max(0, Math.min(minutes, PAIR_WEEKLY_MINUTES - previousMinutes));
}

export function studentClassCredit(minutes) {
  return Math.round((NEURONAS_PER_HOUR * minutes) / HOUR);
}

/**
 * Lo que suma el docente por un turno, según los minutos que contaron de cada
 * presente. El primero vale entero y los demás la mitad: premia al grupo sin
 * que una clase de 50 valga 50 individuales, que desalentaría dar individuales.
 */
export function teacherTurnCredit(studentMinutes) {
  const [first = 0, ...rest] = [...studentMinutes]
    .filter((minutes) => minutes > 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_COUNTED_STUDENTS);
  const extra = rest.reduce((sum, minutes) => sum + minutes, 0);
  return Math.round((NEURONAS_PER_HOUR * (first + EXTRA_STUDENT_FACTOR * extra)) / HOUR);
}

/** El lunes y el domingo de la semana de esa fecha. */
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
 * Lo que le corresponde a cada reserva de un turno y al docente. `weekRows` son
 * las clases realizadas de ese docente en la semana. Se recalcula todo desde el
 * estado actual, y por eso corregir una asistencia revierte sus neuronas sin
 * deshacer nada. El límite mira solo las clases anteriores para que el resultado
 * no dependa del orden en que el docente tomó lista.
 */
export function turnCredits(turnRows, weekRows) {
  const bookings = turnRows.map((row) => {
    const counts = countsForTeacher(row);
    const previous = weekRows
      .filter(
        (other) =>
          String(other.studentId) === String(row.studentId) &&
          countsForTeacher(other) &&
          startsBefore(other, row)
      )
      .reduce((sum, other) => sum + classMinutes(other), 0);
    const minutes = counts ? minutesWithinPairLimit(classMinutes(row), previous) : 0;
    return {
      classId: row.id,
      studentId: row.studentId,
      minutes,
      student: countsForStudent(row) ? studentClassCredit(minutes) : 0,
      bonus: counts && row.rewardType ? rewardBonus(row.rewardNeuronas) : 0,
    };
  });
  return { bookings, teacher: teacherTurnCredit(bookings.map((row) => row.minutes)) };
}

/** Lo que entra de `amount` en un tope, dado lo que ya se sumó. */
export function withinCap(amount, cap, alreadyEarned) {
  return Math.max(0, Math.min(amount, cap - alreadyEarned));
}

/** El bono del docente por dar una clase canjeada: le devuelve parte de lo que regaló. */
export function rewardBonus(rewardNeuronas) {
  return Math.floor(rewardNeuronas / 2);
}

function epochOf(timestamp) {
  const { iso, time } = clockNow(new Date(timestamp));
  return toEpochMinutes(iso, time);
}

/** Con menos de 24 h para hacerla no da neuronas: frena tareas armadas solo para sumar. */
export function homeworkEarns({ createdAt, dueDate, dueTime }) {
  return toEpochMinutes(dueDate, dueTime) - epochOf(createdAt) >= MIN_HOMEWORK_LEAD_MINUTES;
}

/**
 * Neuronas por la velocidad de la devolución. El reloj arranca en lo último
 * entre la última edición y el vencimiento: corregir cierra la entrega, y si
 * corriera desde antes del vencimiento premiaría sacarle tiempo al alumno y
 * castigaría corregir todo el grupo junto al cerrar el plazo.
 */
export function feedbackCredit({ submittedAt, dueDate, dueTime }, now) {
  const clockStart = Math.max(epochOf(submittedAt), toEpochMinutes(dueDate, dueTime));
  const elapsed = toEpochMinutes(now.iso, now.time) - clockStart;
  return FEEDBACK_TIERS.find((tier) => elapsed < tier.under)?.neuronas ?? 0;
}

/**
 * Lo que da la PRIMERA corrección de una entrega, antes de los topes. El alumno
 * no pierde sus neuronas si la devolución es corta: eso es decisión del docente.
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
 */
export function rewardPriceCents(rewardType, { hourlyRateCents, minutes }) {
  const reward = REWARDS[rewardType];
  if (reward.kind === 'free') {
    return classPriceCents(hourlyRateCents, minutes - reward.minutes);
  }
  const base = classPriceCents(hourlyRateCents, Math.min(minutes, HOUR));
  return classPriceCents(hourlyRateCents, minutes) - Math.round((base * reward.percent) / 100);
}

/** El nivel sale de lo acreditado en total, así que gastar neuronas no lo baja. */
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

export function badgesFor({ classesAttended, homeworksOnTime }) {
  return [
    { key: 'first_class', label: 'Primera clase', earned: classesAttended >= 1 },
    { key: 'ten_classes', label: '10 clases', earned: classesAttended >= 10 },
    { key: 'five_homeworks', label: '5 tareas a tiempo', earned: homeworksOnTime >= 5 },
  ];
}

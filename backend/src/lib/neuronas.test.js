import { describe, expect, it } from 'vitest';
import {
  correctionCredits,
  countsForStudent,
  countsForTeacher,
  feedbackCredit,
  homeworkEarns,
  levelFor,
  minutesWithinPairLimit,
  rewardBonus,
  rewardPriceCents,
  rewardProblem,
  studentClassCredit,
  teacherTurnCredit,
  turnCredits,
  weekBounds,
  withinCap,
} from './neuronas.js';

const clase = (over = {}) => ({
  id: 'c1',
  studentId: 's1',
  status: 'realizada',
  date: '2099-09-14',
  startTime: '10:00',
  endTime: '11:00',
  priceCents: 500000,
  paidAt: '2099-09-13T12:00:00.000Z',
  rewardType: null,
  rewardNeuronas: 0,
  packPriceCents: 0,
  ...over,
});

describe('qué clases cuentan', () => {
  it('una clase realizada y paga cuenta para los dos', () => {
    expect(countsForTeacher(clase())).toBe(true);
    expect(countsForStudent(clase())).toBe(true);
  });

  it('una ausencia o una clase sin pagar no cuenta', () => {
    expect(countsForTeacher(clase({ status: 'no_presentada' }))).toBe(false);
    expect(countsForTeacher(clase({ paidAt: null }))).toBe(false);
  });

  it('una clase de $ 0 no cuenta, aunque esté marcada como paga', () => {
    expect(countsForTeacher(clase({ priceCents: 0 }))).toBe(false);
  });

  it('un paquete de $ 0 no cuenta, aunque aceptarlo complete paidAt', () => {
    expect(countsForTeacher(clase({ priceCents: 0, packPriceCents: 0 }))).toBe(false);
  });

  it('un paquete pago cuenta', () => {
    expect(countsForTeacher(clase({ priceCents: 0, packPriceCents: 100000 }))).toBe(true);
  });

  it('un canje cuenta para el docente pero no para el alumno', () => {
    const canjeada = clase({ priceCents: 0, rewardType: 'free_60', rewardNeuronas: 1000 });
    expect(countsForTeacher(canjeada)).toBe(true);
    expect(countsForStudent(canjeada)).toBe(false);
  });

  it('un canje con resto por pagar no cuenta hasta que se pague', () => {
    const conResto = { priceCents: 250000, rewardType: 'free_60', rewardNeuronas: 1000 };
    expect(countsForTeacher(clase({ ...conResto, paidAt: null }))).toBe(false);
    expect(countsForTeacher(clase(conResto))).toBe(true);
  });
});

describe('cuánto suma una clase', () => {
  it('el alumno suma proporcional a los minutos', () => {
    expect(studentClassCredit(60)).toBe(10);
    expect(studentClassCredit(30)).toBe(5);
    expect(studentClassCredit(45)).toBe(8);
  });

  it('cada presente extra suma la mitad', () => {
    expect(teacherTurnCredit([60])).toBe(10);
    expect(teacherTurnCredit([60, 60])).toBe(15);
    expect(teacherTurnCredit([60, 60, 60])).toBe(20);
  });

  it('cuenta hasta 10 presentes', () => {
    expect(teacherTurnCredit(Array(10).fill(60))).toBe(55);
    expect(teacherTurnCredit(Array(50).fill(60))).toBe(55);
  });

  it('sin presentes que cuenten no suma', () => {
    expect(teacherTurnCredit([])).toBe(0);
    expect(teacherTurnCredit([0, 0])).toBe(0);
  });

  it('el límite de la pareja recorta lo que se pasa', () => {
    expect(minutesWithinPairLimit(60, 0)).toBe(60);
    expect(minutesWithinPairLimit(60, 450)).toBe(30);
    expect(minutesWithinPairLimit(60, 480)).toBe(0);
    expect(minutesWithinPairLimit(60, 600)).toBe(0);
  });

  it('el tope nunca da negativo', () => {
    expect(withinCap(30, 150, 100)).toBe(30);
    expect(withinCap(30, 150, 140)).toBe(10);
    expect(withinCap(30, 150, 200)).toBe(0);
  });

  it('el bono es la mitad de lo que gastó el alumno', () => {
    expect(rewardBonus(1000)).toBe(500);
    expect(rewardBonus(250)).toBe(125);
  });

  it('la semana va de lunes a domingo', () => {
    expect(weekBounds('2099-09-14')).toEqual({ monday: '2099-09-14', sunday: '2099-09-20' });
    expect(weekBounds('2099-09-20')).toEqual({ monday: '2099-09-14', sunday: '2099-09-20' });
    expect(weekBounds('2099-09-21').monday).toBe('2099-09-21');
  });
});

describe('turnCredits', () => {
  it('reparte al alumno y al docente', () => {
    const fila = clase();
    expect(turnCredits([fila], [fila])).toEqual({
      bookings: [{ classId: 'c1', studentId: 's1', minutes: 60, student: 10, bonus: 0 }],
      teacher: 10,
    });
  });

  it('un ausente no suma para nadie, y por eso corregir revierte', () => {
    const fila = clase({ status: 'no_presentada' });
    const { bookings, teacher } = turnCredits([fila], []);
    expect(bookings[0].student).toBe(0);
    expect(teacher).toBe(0);
  });

  it('en una grupal cuentan solo los presentes pagos', () => {
    const presente = clase();
    const otro = clase({ id: 'c2', studentId: 's2' });
    const ausente = clase({ id: 'c3', studentId: 's3', status: 'no_presentada' });
    const { teacher } = turnCredits([presente, otro, ausente], [presente, otro]);
    expect(teacher).toBe(15);
  });

  it('una clase canjeada da bono al docente y nada al alumno', () => {
    const fila = clase({ priceCents: 0, rewardType: 'free_60', rewardNeuronas: 1000 });
    const { bookings, teacher } = turnCredits([fila], [fila]);
    expect(bookings[0]).toMatchObject({ student: 0, bonus: 500 });
    expect(teacher).toBe(10);
  });

  it('el límite de 8 h mira solo las clases anteriores de esa pareja', () => {
    const lunes = clase({ id: 'a', startTime: '08:00', endTime: '15:30' });
    const martes = clase({ id: 'b', date: '2099-09-15' });
    const deOtro = clase({ id: 'x', studentId: 's9', startTime: '08:00', endTime: '15:30' });
    const semana = [lunes, martes, deOtro];

    // Quedan 30 min del límite después de las 7 h 30 del lunes.
    expect(turnCredits([martes], semana).bookings[0].minutes).toBe(30);
    // Tomar lista del martes antes no le cambia nada al lunes.
    expect(turnCredits([lunes], semana).bookings[0].minutes).toBe(450);
  });
});

describe('devoluciones', () => {
  // 12:00 en Argentina son 15:00 UTC.
  const entrega = {
    submittedAt: '2099-09-10T15:00:00.000Z',
    dueDate: '2099-09-10',
    dueTime: '12:00',
  };
  const a = (iso, time) => ({ iso, time });

  it('da 10 / 6 / 3 / 0 según el tramo', () => {
    expect(feedbackCredit(entrega, a('2099-09-11', '11:59'))).toBe(10);
    expect(feedbackCredit(entrega, a('2099-09-11', '12:00'))).toBe(6);
    expect(feedbackCredit(entrega, a('2099-09-13', '11:59'))).toBe(6);
    expect(feedbackCredit(entrega, a('2099-09-13', '12:00'))).toBe(3);
    expect(feedbackCredit(entrega, a('2099-09-17', '11:59'))).toBe(3);
    expect(feedbackCredit(entrega, a('2099-09-17', '12:00'))).toBe(0);
  });

  it('con una entrega anticipada el reloj arranca en el vencimiento', () => {
    const anticipada = { ...entrega, submittedAt: '2099-09-01T15:00:00.000Z' };
    expect(feedbackCredit(anticipada, a('2099-09-10', '20:00'))).toBe(10);
    expect(feedbackCredit(anticipada, a('2099-09-05', '10:00'))).toBe(10);
  });

  it('con una entrega fuera de término el reloj arranca al entregar', () => {
    const tarde = { ...entrega, submittedAt: '2099-09-13T15:00:00.000Z' };
    expect(feedbackCredit(tarde, a('2099-09-14', '11:59'))).toBe(10);
  });

  it('una tarea con menos de 24 h de plazo no da neuronas', () => {
    const creada = (createdAt) => ({ ...entrega, createdAt, isLate: false });
    expect(homeworkEarns(creada('2099-09-09T15:00:00.000Z'))).toBe(true);
    expect(homeworkEarns(creada('2099-09-09T15:01:00.000Z'))).toBe(false);
    expect(
      correctionCredits(creada('2099-09-10T10:00:00.000Z'), 'Una devolución bien larga', a('2099-09-10', '13:00'))
    ).toEqual({ teacher: 0, student: 0 });
  });

  it('una devolución corta no le suma al docente, pero el alumno cobra igual', () => {
    const tarea = { ...entrega, createdAt: '2099-09-01T15:00:00.000Z', isLate: false };
    expect(correctionCredits(tarea, 'Bien', a('2099-09-10', '13:00'))).toEqual({
      teacher: 0,
      student: 10,
    });
  });

  it('una entrega fuera de término no le suma al alumno', () => {
    const tarea = { ...entrega, createdAt: '2099-09-01T15:00:00.000Z', isLate: true };
    expect(correctionCredits(tarea, 'Una devolución bien larga', a('2099-09-10', '13:00'))).toEqual({
      teacher: 10,
      student: 0,
    });
  });
});

describe('canjes', () => {
  const hora = { hourlyRateCents: 500000, minutes: 60 };

  it('la clase gratis cubre sus minutos y cobra el resto', () => {
    expect(rewardPriceCents('free_60', hora)).toBe(0);
    expect(rewardPriceCents('free_30', hora)).toBe(250000);
    expect(rewardPriceCents('free_60', { ...hora, minutes: 90 })).toBe(250000);
  });

  it('el descuento no pasa de los primeros 60 minutos', () => {
    expect(rewardPriceCents('discount_10', hora)).toBe(450000);
    expect(rewardPriceCents('discount_20', { ...hora, minutes: 30 })).toBe(200000);
    expect(rewardPriceCents('discount_20', { ...hora, minutes: 120 })).toBe(900000);
  });

  it('no se canjea en una clase más corta que lo cubierto ni en una gratis', () => {
    expect(rewardProblem('free_60', { ...hora, minutes: 30 })).toMatch(/60 minutos/);
    expect(rewardProblem('free_30', { ...hora, minutes: 30 })).toBeNull();
    expect(rewardProblem('discount_10', { ...hora, hourlyRateCents: 0 })).toMatch(/gratis/);
  });
});

describe('niveles', () => {
  it('sube por lo acreditado', () => {
    expect(levelFor(0)).toEqual({ name: 'Neurona', min: 0, nextName: 'Sinapsis', nextMin: 200 });
    expect(levelFor(199).name).toBe('Neurona');
    expect(levelFor(200).name).toBe('Sinapsis');
    expect(levelFor(600).name).toBe('Red neuronal');
  });

  it('el último nivel no tiene siguiente', () => {
    expect(levelFor(5000)).toEqual({
      name: 'Mente brillante',
      min: 1500,
      nextName: null,
      nextMin: null,
    });
  });
});

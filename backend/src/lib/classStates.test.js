import { describe, expect, it } from 'vitest';
import {
  cancelReasonFor,
  checkAction,
  hasStarted,
  minutesUntilStart,
} from './classStates.js';

// La clase es el lunes 14/9 a las 13:00. "Ahora" se mueve alrededor.
const clase = (over = {}) => ({
  date: '2099-09-14',
  startTime: '13:00',
  status: 'pendiente',
  paidAt: null,
  ...over,
});

const NOW_LEJOS = { iso: '2099-09-10', time: '10:00' };
// Exactamente 24 h antes: todavía se puede.
const NOW_24H = { iso: '2099-09-13', time: '13:00' };
// 23 h 59 min antes: ya no.
const NOW_CASI = { iso: '2099-09-13', time: '13:01' };
const NOW_EMPEZADA = { iso: '2099-09-14', time: '13:00' };

const alumno = (now) => ({ role: 'student', now });
const docente = (now) => ({ role: 'teacher', now });

describe('tiempo', () => {
  it('cuenta los minutos que faltan cruzando días', () => {
    expect(minutesUntilStart(clase(), NOW_24H)).toBe(24 * 60);
    expect(minutesUntilStart(clase(), { iso: '2099-09-14', time: '14:30' })).toBe(-90);
  });

  it('a la hora de inicio ya empezó', () => {
    expect(hasStarted(clase(), NOW_EMPEZADA)).toBe(true);
    expect(hasStarted(clase(), { iso: '2099-09-14', time: '12:59' })).toBe(false);
  });
});

describe('aceptar', () => {
  it('el docente acepta una pendiente antes de que empiece', () => {
    expect(checkAction('accept', clase(), docente(NOW_CASI))).toBeNull();
  });

  it('el alumno no puede aceptar', () => {
    expect(checkAction('accept', clase(), alumno(NOW_LEJOS)).status).toBe(403);
  });

  it('no se acepta algo que ya empezó ni algo que no está pendiente', () => {
    expect(checkAction('accept', clase(), docente(NOW_EMPEZADA)).status).toBe(409);
    expect(checkAction('accept', clase({ status: 'aceptada' }), docente(NOW_LEJOS)).status).toBe(409);
  });
});

describe('cancelar', () => {
  it('el alumno retira una pendiente aunque falte poco', () => {
    expect(checkAction('cancel', clase(), alumno(NOW_CASI))).toBeNull();
  });

  it('el alumno cancela una aceptada o confirmada solo con 24 h de anticipación', () => {
    for (const status of ['aceptada', 'confirmada']) {
      expect(checkAction('cancel', clase({ status }), alumno(NOW_24H))).toBeNull();
      const res = checkAction('cancel', clase({ status }), alumno(NOW_CASI));
      expect(res.status).toBe(409);
      expect(res.message).toMatch(/24 h/);
    }
  });

  it('el docente cancela hasta que empieza, sin regla de 24 h', () => {
    for (const status of ['pendiente', 'aceptada', 'confirmada']) {
      expect(checkAction('cancel', clase({ status }), docente(NOW_CASI))).toBeNull();
      expect(checkAction('cancel', clase({ status }), docente(NOW_EMPEZADA)).status).toBe(409);
    }
  });

  it('no se cancela algo cerrado', () => {
    for (const status of ['realizada', 'no_presentada', 'cancelada']) {
      expect(checkAction('cancel', clase({ status }), docente(NOW_LEJOS)).status).toBe(409);
    }
  });

  it('el docente que dice que no a una pendiente la rechaza', () => {
    expect(cancelReasonFor(clase(), 'teacher')).toBe('rechazada');
    expect(cancelReasonFor(clase({ status: 'aceptada' }), 'teacher')).toBe('cancelada');
    expect(cancelReasonFor(clase(), 'student')).toBe('cancelada');
  });
});

describe('pagar', () => {
  it('el alumno paga una aceptada, incluso después de la clase', () => {
    expect(checkAction('pay', clase({ status: 'aceptada' }), alumno(NOW_LEJOS))).toBeNull();
    expect(
      checkAction('pay', clase({ status: 'aceptada' }), alumno({ iso: '2099-10-01', time: '10:00' }))
    ).toBeNull();
  });

  it('se puede pagar una realizada o no presentada que se debe', () => {
    expect(checkAction('pay', clase({ status: 'realizada' }), alumno(NOW_EMPEZADA))).toBeNull();
    expect(checkAction('pay', clase({ status: 'no_presentada' }), alumno(NOW_EMPEZADA))).toBeNull();
  });

  it('no se paga dos veces, ni antes de que acepte el docente', () => {
    expect(
      checkAction('pay', clase({ status: 'realizada', paidAt: '2099-09-14T15:00:00Z' }), alumno(NOW_LEJOS))
        .status
    ).toBe(409);
    expect(checkAction('pay', clase(), alumno(NOW_LEJOS)).message).toMatch(/acepte/);
    expect(checkAction('pay', clase({ status: 'cancelada' }), alumno(NOW_LEJOS)).status).toBe(409);
  });

  it('el docente no paga', () => {
    expect(checkAction('pay', clase({ status: 'aceptada' }), docente(NOW_LEJOS)).status).toBe(403);
  });
});

describe('tomar lista', () => {
  it('desde que empieza, en aceptadas o confirmadas', () => {
    for (const status of ['aceptada', 'confirmada']) {
      expect(checkAction('attend', clase({ status }), docente(NOW_EMPEZADA))).toBeNull();
      expect(checkAction('attend', clase({ status }), docente(NOW_CASI)).status).toBe(409);
    }
  });

  it('se puede corregir la marca', () => {
    expect(checkAction('attend', clase({ status: 'realizada' }), docente(NOW_EMPEZADA))).toBeNull();
    expect(checkAction('attend', clase({ status: 'no_presentada' }), docente(NOW_EMPEZADA))).toBeNull();
  });

  it('no en pendientes ni canceladas, ni por el alumno', () => {
    expect(checkAction('attend', clase(), docente(NOW_EMPEZADA)).status).toBe(409);
    expect(checkAction('attend', clase({ status: 'cancelada' }), docente(NOW_EMPEZADA)).status).toBe(409);
    expect(checkAction('attend', clase({ status: 'confirmada' }), alumno(NOW_EMPEZADA)).status).toBe(403);
  });
});

describe('reprogramar', () => {
  it('solo una confirmada, con 24 h de anticipación', () => {
    expect(checkAction('reschedule', clase({ status: 'confirmada' }), alumno(NOW_24H))).toBeNull();
    expect(checkAction('reschedule', clase({ status: 'confirmada' }), alumno(NOW_CASI)).status).toBe(409);
    expect(checkAction('reschedule', clase({ status: 'aceptada' }), alumno(NOW_LEJOS)).status).toBe(409);
  });
});

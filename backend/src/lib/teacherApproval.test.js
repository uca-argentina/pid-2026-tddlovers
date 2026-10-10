import { describe, expect, it } from 'vitest';
import { APPROVAL_STATUSES, TeacherApproval } from './teacherApproval.js';

const pendiente = () => new TeacherApproval('pending');
const aprobado = () => new TeacherApproval('approved');
const rechazado = () => new TeacherApproval('rejected');

describe('TeacherApproval', () => {
  it('conoce los tres estados', () => {
    expect(APPROVAL_STATUSES).toEqual(['pending', 'approved', 'rejected']);
  });

  it('no acepta un estado inventado', () => {
    expect(() => new TeacherApproval('aprobado')).toThrow();
  });

  describe('reservas', () => {
    it('solo un docente aprobado recibe reservas', () => {
      expect(aprobado().canReceiveBookings()).toBe(true);
      expect(pendiente().canReceiveBookings()).toBe(false);
      expect(rechazado().canReceiveBookings()).toBe(false);
    });

    it('sin estado (no es docente) no recibe reservas', () => {
      expect(new TeacherApproval(null).canReceiveBookings()).toBe(false);
    });

    it('explica por qué no se puede reservar', () => {
      expect(aprobado().bookingProblem()).toBeNull();
      const problema = pendiente().bookingProblem();
      expect(problema.status).toBe(409);
      expect(problema.message).toMatch(/reservas/);
    });
  });

  describe('aprobar', () => {
    it('se aprueba un pendiente o un rechazado', () => {
      expect(pendiente().check('approve')).toBeNull();
      expect(rechazado().check('approve')).toBeNull();
    });

    it('no se aprueba dos veces', () => {
      expect(aprobado().check('approve').status).toBe(409);
    });

    it('lleva a aprobado', () => {
      expect(pendiente().approve().status).toBe('approved');
    });
  });

  describe('rechazar', () => {
    it('se rechaza un pendiente o un aprobado', () => {
      expect(pendiente().check('reject')).toBeNull();
      expect(aprobado().check('reject')).toBeNull();
    });

    it('no se rechaza dos veces', () => {
      expect(rechazado().check('reject').status).toBe(409);
    });

    it('lleva a rechazado', () => {
      expect(pendiente().reject().status).toBe('rejected');
    });
  });

  it('una acción desconocida es un 400', () => {
    expect(pendiente().check('borrar').status).toBe(400);
  });

  it('una transición inválida tira en vez de devolver cualquier cosa', () => {
    expect(() => aprobado().approve()).toThrow();
  });

  describe('editar el perfil', () => {
    it('un rechazado que edita vuelve a revisión', () => {
      expect(rechazado().afterProfileEdit().status).toBe('pending');
    });

    it('pendiente y aprobado no cambian', () => {
      expect(pendiente().afterProfileEdit().status).toBe('pending');
      expect(aprobado().afterProfileEdit().status).toBe('approved');
    });
  });

  it('es inmutable: las transiciones devuelven otro objeto', () => {
    const original = pendiente();
    original.approve();
    expect(original.status).toBe('pending');
  });
});

import { describe, expect, it } from 'vitest';
import { validateWindow } from './availabilityWindow.js';

const HOY = '2026-09-22';
const MATE = '47ac9e88-4099-4ab4-b1fe-3898d7b279c4';

const ventana = (over = {}) => ({
  date: '2026-09-28',
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  subjectId: MATE,
  durationMinutes: 60,
  price: 15000,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  locality: '',
  address: '',
  ...over,
});

const validar = (over, opts = {}) => validateWindow(ventana(over), { today: HOY, ...opts });

describe('validateWindow', () => {
  it('accepts a complete virtual window and drops the unused address', () => {
    const { value } = validar();
    expect(value).toMatchObject({ modality: 'virtual', locality: null, address: null });
    expect(value.meetingUrl).toBe('https://meet.example.com/abc');
  });

  it('accepts a class as long as the window', () => {
    expect(validar({ end: '14:00' }).value).toBeDefined();
  });

  it('accepts a window that ends at midnight', () => {
    expect(validar({ start: '23:00', end: '24:00' }).value).toBeDefined();
  });

  it('rejects a class longer than the window', () => {
    expect(validar({ durationMinutes: 150 }).fields).toEqual({ durationMinutes: 'invalid' });
  });

  it('accepts any duration of at least 30 minutes', () => {
    expect(validar({ durationMinutes: 45 }).value.durationMinutes).toBe(45);
    expect(validar({ durationMinutes: 50 }).value).toBeDefined();
  });

  it('rejects durations under 30 minutes or that are not whole minutes', () => {
    expect(validar({ durationMinutes: 29 }).fields).toEqual({ durationMinutes: 'invalid' });
    expect(validar({ durationMinutes: 45.5 }).fields).toEqual({ durationMinutes: 'invalid' });
    expect(validar({ durationMinutes: '60' }).fields).toEqual({ durationMinutes: 'invalid' });
  });

  it('requires a price in whole pesos, 0 meaning free', () => {
    expect(validar({ price: 0 }).value.price).toBe(0);
    expect(validar({ price: 15000 }).value.price).toBe(15000);
    expect(validar({ price: undefined }).fields).toEqual({ price: 'invalid' });
    expect(validar({ price: -1 }).fields).toEqual({ price: 'invalid' });
    expect(validar({ price: 1500.5 }).fields).toEqual({ price: 'invalid' });
    expect(validar({ price: '15000' }).fields).toEqual({ price: 'invalid' });
  });

  it('accepts a 30 minute class', () => {
    expect(validar({ durationMinutes: 30 }).value).toBeDefined();
  });

  it('rejects times off the half hour and reversed ranges', () => {
    expect(validar({ start: '13:15' }).fields).toEqual({ start: 'invalid' });
    expect(validar({ start: '15:00', end: '13:00' }).fields).toEqual({ end: 'invalid' });
    expect(validar({ start: '24:00' }).fields).toEqual({ start: 'invalid' });
  });

  it('requires a subject', () => {
    expect(validar({ subjectId: '' }).fields).toEqual({ subjectId: 'required' });
  });

  it('requires the link for virtual and hybrid classes', () => {
    expect(validar({ meetingUrl: '  ' }).fields).toEqual({ meetingUrl: 'required' });
    expect(validar({ modality: 'hybrid', locality: 'Puerto Madero', address: 'Av. Alicia Moreau de Justo 1300', meetingUrl: '' }).fields)
      .toEqual({ meetingUrl: 'required' });
  });

  it('only accepts web links', () => {
    expect(validar({ meetingUrl: 'javascript:alert(1)' }).fields).toEqual({ meetingUrl: 'invalid' });
    expect(validar({ meetingUrl: 'meet' }).fields).toEqual({ meetingUrl: 'invalid' });
  });

  it('requires locality and exact address for in-person classes, and drops the unused link', () => {
    expect(validar({ modality: 'in_person', address: 'Aula 3' }).fields).toEqual({ locality: 'required' });
    expect(validar({ modality: 'in_person', locality: 'Palermo' }).fields).toEqual({ address: 'required' });
    const { value } = validar({
      modality: 'in_person',
      locality: ' Puerto Madero, CABA ',
      address: '  Av. Alicia Moreau de Justo 1300 ',
    });
    expect(value).toMatchObject({
      locality: 'Puerto Madero, CABA',
      address: 'Av. Alicia Moreau de Justo 1300',
      meetingUrl: null,
    });
  });

  it('a hybrid class needs locality too', () => {
    const hibrida = { modality: 'hybrid', address: 'Aula 3', meetingUrl: 'https://meet.example.com/abc' };
    expect(validar(hibrida).fields).toEqual({ locality: 'required' });
    expect(validar({ ...hibrida, locality: 'Palermo' }).value.locality).toBe('Palermo');
  });

  it('a virtual class keeps neither locality nor address', () => {
    const { value } = validar({ locality: 'Palermo', address: 'Aula 3' });
    expect(value).toMatchObject({ locality: null, address: null });
  });

  it('rejects an unknown modality', () => {
    expect(validar({ modality: 'presencial' }).fields).toEqual({ modality: 'invalid' });
  });

  it('caps the group size', () => {
    expect(validar({ maxStudents: 5 }).value.maxStudents).toBe(5);
    expect(validar({ maxStudents: 0 }).fields).toEqual({ maxStudents: 'invalid' });
    expect(validar({ maxStudents: 51 }).fields).toEqual({ maxStudents: 'invalid' });
  });

  it('rejects dates that do not exist', () => {
    expect(validar({ date: '2026-02-31' }).fields).toEqual({ date: 'invalid' });
  });

  it('rejects a new window in the past', () => {
    expect(validar({ date: '2026-09-21' }).fields).toEqual({ date: 'invalid' });
    expect(validar({ date: '2026-09-21', repeatsWeekly: true }).fields).toEqual({ date: 'invalid' });
  });

  it('lets a weekly window keep its original past date when edited', () => {
    const editada = validar({ date: '2026-09-07', repeatsWeekly: true }, { allowPastDate: true });
    expect(editada.value).toBeDefined();
    // Una suelta del pasado no: esa clase ya fue.
    expect(validar({ date: '2026-09-07' }, { allowPastDate: true }).fields).toEqual({ date: 'invalid' });
  });
});

import { describe, expect, it } from 'vitest';
import { validateWindow } from './availabilityWindow.js';

const HOY = '2026-09-22';

const ventana = (over = {}) => ({
  date: '2026-09-28',
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  ...over,
});

const DIRECCION_ID = '2a3b4c5d-6e7f-4a8b-9c0d-1e2f3a4b5c6d';
const nueva = {
  street: 'Av. Alicia Moreau de Justo',
  number: '1300',
  postalCode: '1107',
  locality: 'Puerto Madero',
  city: 'CABA',
};

const validar = (over, opts = {}) => validateWindow(ventana(over), { today: HOY, ...opts });

describe('validateWindow', () => {
  it('accepts a complete virtual window and drops the unused address', () => {
    const { value } = validar({ addressId: DIRECCION_ID });
    expect(value).toMatchObject({ modality: 'virtual', addressId: null, newAddress: null });
    expect(value.meetingUrl).toBe('https://meet.example.com/abc');
  });

  it('accepts the shortest window, room for one 30 minute class', () => {
    expect(validar({ end: '13:30' }).value).toBeDefined();
  });

  it('accepts a window that ends at midnight', () => {
    expect(validar({ start: '23:00', end: '24:00' }).value).toBeDefined();
  });

  it("keeps only the window's own fields: subject, duration and price are the student's", () => {
    const { value } = validar({ subjectId: 'x', durationMinutes: 45, price: 100 });
    expect(value).not.toHaveProperty('subjectId');
    expect(value).not.toHaveProperty('durationMinutes');
    expect(value).not.toHaveProperty('price');
  });

  it('rejects times off the half hour and reversed ranges', () => {
    expect(validar({ start: '13:15' }).fields).toEqual({ start: 'invalid' });
    expect(validar({ start: '15:00', end: '13:00' }).fields).toEqual({ end: 'invalid' });
    expect(validar({ start: '24:00' }).fields).toEqual({ start: 'invalid' });
  });

  it('requires the link for virtual and hybrid classes', () => {
    expect(validar({ meetingUrl: '  ' }).fields).toEqual({ meetingUrl: 'required' });
    expect(validar({ modality: 'hybrid', addressId: DIRECCION_ID, meetingUrl: '' }).fields).toEqual({
      meetingUrl: 'required',
    });
  });

  it('only accepts web links', () => {
    expect(validar({ meetingUrl: 'javascript:alert(1)' }).fields).toEqual({ meetingUrl: 'invalid' });
    expect(validar({ meetingUrl: 'meet' }).fields).toEqual({ meetingUrl: 'invalid' });
  });

  it('an in-person class needs an address, and drops the unused link', () => {
    expect(validar({ modality: 'in_person' }).fields).toEqual({ addressId: 'required' });
    expect(validar({ modality: 'in_person', addressId: 'no-es-un-id' }).fields).toEqual({
      addressId: 'required',
    });
    const { value } = validar({ modality: 'in_person', addressId: DIRECCION_ID });
    expect(value).toMatchObject({ addressId: DIRECCION_ID, newAddress: null, meetingUrl: null });
  });

  it('a new address is validated; it only needs a name if it is saved', () => {
    const suelta = validar({ modality: 'in_person', address: nueva });
    expect(suelta.value).toMatchObject({ addressId: null, saveAddress: false });
    expect(suelta.value.newAddress).toMatchObject({ ...nueva, label: null, floor: null });

    expect(validar({ modality: 'in_person', address: nueva, saveAddress: true }).fields).toEqual({
      label: 'required',
    });
    const guardar = validar({
      modality: 'hybrid',
      address: { ...nueva, label: 'Oficina' },
      saveAddress: true,
    });
    expect(guardar.value).toMatchObject({ saveAddress: true, newAddress: { label: 'Oficina' } });
    expect(validar({ modality: 'in_person', address: { ...nueva, city: '' } }).fields).toEqual({
      city: 'required',
    });
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

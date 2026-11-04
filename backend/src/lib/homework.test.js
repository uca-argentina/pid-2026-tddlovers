import { describe, expect, it } from 'vitest';
import {
  checkChat,
  checkCorrect,
  checkSubmit,
  isPastDue,
  isSafeLink,
  validateFeedback,
  validateHomework,
  validateMessage,
  validateSubmission,
} from './homework.js';

const NOW = { iso: '2099-09-14', time: '13:00' };

describe('isPastDue', () => {
  it('el minuto del vencimiento todavía está en término', () => {
    expect(isPastDue({ dueDate: '2099-09-14', dueTime: '13:00' }, NOW)).toBe(false);
  });

  it('un minuto después ya no', () => {
    expect(isPastDue({ dueDate: '2099-09-14', dueTime: '12:59' }, NOW)).toBe(true);
  });

  it('compara primero la fecha', () => {
    expect(isPastDue({ dueDate: '2099-09-13', dueTime: '23:59' }, NOW)).toBe(true);
    expect(isPastDue({ dueDate: '2099-09-15', dueTime: '00:00' }, NOW)).toBe(false);
  });
});

describe('validateHomework', () => {
  const ok = { title: ' TP 1 ', description: ' Hacer ', dueDate: '2099-09-20', dueTime: '23:59' };

  it('normaliza los textos', () => {
    expect(validateHomework(ok, NOW).homework).toEqual({
      title: 'TP 1',
      description: 'Hacer',
      dueDate: '2099-09-20',
      dueTime: '23:59',
    });
  });

  it('la consigna es opcional', () => {
    const { description, ...sinConsigna } = ok;
    expect(validateHomework(sinConsigna, NOW).homework.description).toBe('');
  });

  it.each([
    ['title', { title: '  ' }],
    ['title', { title: 'x'.repeat(121) }],
    ['description', { description: 'x'.repeat(5001) }],
    ['dueDate', { dueDate: '2099-02-31' }],
    ['dueDate', { dueDate: 'mañana' }],
    ['dueTime', { dueTime: '24:00' }],
    ['dueDate', { dueDate: '2099-09-14', dueTime: '12:00' }],
  ])('rechaza %s inválido', (field, over) => {
    expect(validateHomework({ ...ok, ...over }, NOW).error.fields).toEqual({ [field]: 'invalid' });
  });
});

describe('isSafeLink', () => {
  it.each(['https://drive.google.com/x', 'http://example.com'])('acepta %s', (link) => {
    expect(isSafeLink(link)).toBe(true);
  });

  it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.com', 'hola'])('rechaza %s', (link) => {
    expect(isSafeLink(link)).toBe(false);
  });
});

describe('validateSubmission', () => {
  it('alcanza con un texto', () => {
    expect(validateSubmission({ text: ' Hola ' }).submission).toEqual({ text: 'Hola', linkUrl: '' });
  });

  it('alcanza con un enlace', () => {
    expect(validateSubmission({ linkUrl: 'https://x.com' }).submission.linkUrl).toBe('https://x.com');
  });

  it('vacía no es una entrega', () => {
    expect(validateSubmission({ text: ' ', linkUrl: '' }).error.fields).toEqual({ text: 'invalid' });
  });

  it('no acepta un enlace que no sea web', () => {
    expect(validateSubmission({ linkUrl: 'javascript:alert(1)' }).error.fields).toEqual({
      linkUrl: 'invalid',
    });
  });

  it('no acepta tipos que no sean texto', () => {
    expect(validateSubmission({ text: 3 }).error).toBeDefined();
  });
});

describe('validateFeedback y validateMessage', () => {
  it('recortan el texto', () => {
    expect(validateFeedback(' Muy bien ').feedback).toBe('Muy bien');
    expect(validateMessage(' Hola ').body).toBe('Hola');
  });

  it('rechazan vacíos y de más', () => {
    expect(validateFeedback('  ').error).toBeDefined();
    expect(validateFeedback('x'.repeat(5001)).error).toBeDefined();
    expect(validateMessage('').error).toBeDefined();
    expect(validateMessage('x'.repeat(2001)).error).toBeDefined();
  });
});

describe('quién puede hacer qué', () => {
  const sinEntregar = { submittedAt: null, correctedAt: null };
  const entregada = { submittedAt: '2099-09-14T12:00:00Z', correctedAt: null };
  const corregida = { ...entregada, correctedAt: '2099-09-15T12:00:00Z' };

  it('una entrega corregida ya no se cambia', () => {
    expect(checkSubmit(sinEntregar)).toBeNull();
    expect(checkSubmit(entregada)).toBeNull();
    expect(checkSubmit(corregida).status).toBe(409);
  });

  it('solo se corrige lo entregado', () => {
    expect(checkCorrect(sinEntregar).status).toBe(409);
    expect(checkCorrect(entregada)).toBeNull();
  });

  it('el chat se abre al entregar y sigue después de corregir', () => {
    expect(checkChat(sinEntregar).status).toBe(409);
    expect(checkChat(entregada)).toBeNull();
    expect(checkChat(corregida)).toBeNull();
  });
});

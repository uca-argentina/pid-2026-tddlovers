import { describe, expect, it } from 'vitest';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_TURN,
  MAX_TURN_BYTES,
  checkEditMaterial,
  checkUploadRoom,
  checkViewMaterial,
  contentDisposition,
  hasEnded,
  inlineSafe,
  sanitizeFilename,
  validateSummary,
} from './classMaterials.js';

// La clase es el 14/9 de 13:00 a 14:30.
const clase = (over = {}) => ({
  date: '2099-09-14',
  startTime: '13:00',
  endTime: '14:30',
  status: 'confirmada',
  ...over,
});

const EN_CURSO = { iso: '2099-09-14', time: '14:29' };
const TERMINADA = { iso: '2099-09-14', time: '14:30' };
const DIAS_DESPUES = { iso: '2099-09-20', time: '09:00' };

describe('hasEnded', () => {
  it('termina justo a la hora de fin', () => {
    expect(hasEnded(clase(), EN_CURSO)).toBe(false);
    expect(hasEnded(clase(), TERMINADA)).toBe(true);
  });

  it('un fin "24:00" es la medianoche siguiente', () => {
    const tarde = clase({ startTime: '23:00', endTime: '24:00' });
    expect(hasEnded(tarde, { iso: '2099-09-14', time: '23:59' })).toBe(false);
    expect(hasEnded(tarde, { iso: '2099-09-15', time: '00:00' })).toBe(true);
  });
});

describe('checkEditMaterial', () => {
  const docente = (now) => ({ role: 'teacher', now });

  it('el docente carga cuando la clase terminó', () => {
    expect(checkEditMaterial(clase(), docente(TERMINADA))).toBeNull();
    expect(checkEditMaterial(clase({ status: 'realizada' }), docente(DIAS_DESPUES))).toBeNull();
    expect(checkEditMaterial(clase({ status: 'no_presentada' }), docente(DIAS_DESPUES))).toBeNull();
  });

  it('antes de que termine no', () => {
    expect(checkEditMaterial(clase(), docente(EN_CURSO))).toMatchObject({ status: 409 });
  });

  it('una cancelada o pendiente no se dio', () => {
    expect(checkEditMaterial(clase({ status: 'cancelada' }), docente(DIAS_DESPUES))).toMatchObject({
      status: 409,
    });
    expect(checkEditMaterial(clase({ status: 'pendiente' }), docente(DIAS_DESPUES))).toMatchObject({
      status: 409,
    });
  });

  it('el alumno nunca carga', () => {
    expect(checkEditMaterial(clase(), { role: 'student', now: DIAS_DESPUES })).toMatchObject({
      status: 403,
    });
  });
});

describe('checkViewMaterial', () => {
  const alumno = (now) => ({ role: 'student', now });

  it('el alumno lo ve cuando terminó, aunque haya faltado', () => {
    expect(checkViewMaterial(clase(), alumno(TERMINADA))).toBeNull();
    expect(checkViewMaterial(clase({ status: 'no_presentada' }), alumno(DIAS_DESPUES))).toBeNull();
  });

  it('antes de terminar o cancelada, no', () => {
    expect(checkViewMaterial(clase(), alumno(EN_CURSO))).toMatchObject({ status: 409 });
    expect(checkViewMaterial(clase({ status: 'cancelada' }), alumno(DIAS_DESPUES))).toMatchObject({
      status: 409,
    });
  });
});

describe('validateSummary', () => {
  it('recorta y acepta vacío (borrar el resumen)', () => {
    expect(validateSummary('  Vimos derivadas  ')).toEqual({ summary: 'Vimos derivadas' });
    expect(validateSummary('')).toEqual({ summary: '' });
  });

  it('rechaza lo que no es texto o es muy largo', () => {
    expect(validateSummary(undefined)).toHaveProperty('error');
    expect(validateSummary('a'.repeat(5001))).toHaveProperty('error');
  });
});

describe('sanitizeFilename', () => {
  it('saca carpetas y caracteres de control', () => {
    expect(sanitizeFilename('C:\\Users\\ana\\tp.pdf')).toBe('tp.pdf');
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('ho\u0000la".py')).toBe('hola.py');
  });

  it('un nombre vacío queda como "archivo"', () => {
    expect(sanitizeFilename('')).toBe('archivo');
  });

  it('acorta sin perder la extensión', () => {
    const name = sanitizeFilename(`${'a'.repeat(300)}.docx`);
    expect(name).toHaveLength(255);
    expect(name.endsWith('.docx')).toBe(true);
  });
});

describe('checkUploadRoom', () => {
  const vacio = { count: 0, bytes: 0 };

  it('acepta lo que entra', () => {
    expect(checkUploadRoom(vacio, [{ sizeBytes: 1000 }, { sizeBytes: 2000 }])).toBeNull();
  });

  it('rechaza sin archivos, vacíos o muy pesados', () => {
    expect(checkUploadRoom(vacio, [])).toMatch(/al menos un archivo/);
    expect(checkUploadRoom(vacio, [{ sizeBytes: 0 }])).toMatch(/vacío/);
    expect(checkUploadRoom(vacio, [{ sizeBytes: MAX_FILE_BYTES + 1 }])).toMatch(/hasta 10 MB/);
  });

  it('suma lo que ya tiene el turno', () => {
    const lleno = { count: MAX_FILES_PER_TURN, bytes: 0 };
    expect(checkUploadRoom(lleno, [{ sizeBytes: 1 }])).toMatch(/hasta 20 archivos/);
    const pesado = { count: 1, bytes: MAX_TURN_BYTES - 10 };
    expect(checkUploadRoom(pesado, [{ sizeBytes: 11 }])).toMatch(/hasta 25 MB/);
  });
});

describe('descargas', () => {
  it('solo las imágenes comunes se muestran inline', () => {
    expect(inlineSafe('image/png')).toBe(true);
    expect(inlineSafe('image/svg+xml')).toBe(false);
    expect(inlineSafe('text/html')).toBe(false);
  });

  it('el nombre viaja en ASCII y en UTF-8', () => {
    expect(contentDisposition('Clase de física.pdf', 'application/pdf')).toBe(
      `attachment; filename="Clase de f_sica.pdf"; filename*=UTF-8''Clase%20de%20f%C3%ADsica.pdf`
    );
    expect(contentDisposition('foto.png', 'image/png')).toMatch(/^inline;/);
  });
});

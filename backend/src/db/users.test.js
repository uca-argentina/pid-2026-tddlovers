import { describe, expect, it, vi } from 'vitest';

// Sin Postgres: se mira qué filtra la consulta del buscador.
const query = vi.fn();
vi.mock('./pool.js', () => ({ getPool: () => ({ query }) }));

const { listTeachers } = await import('./users.js');
const { hasRateInModality, ratedSubjectsJson } = await import('./rates.js');

describe('listTeachers', () => {
  it('only suggests approved teachers with a publishable window that has not ended', async () => {
    const docentes = [
      { id: 't1', nombre: 'Laura', apellido: 'Gómez', subjects: [{ id: 's1', name: 'Física' }] },
    ];
    query.mockResolvedValueOnce({ rows: docentes });

    expect(await listTeachers({ today: '2099-09-07' })).toEqual(docentes);

    const [sql, params] = query.mock.calls[0];
    expect(params).toEqual(['2099-09-07']);
    expect(sql).toContain("u.approval_status = 'approved'");
    // Semanal, o suelta desde hoy en hora argentina.
    expect(sql).toContain('(av.repeats_weekly OR av.start_date >= $1::date)');
    // Los mismos fragmentos que el tablero y favoritos.
    expect(sql).toContain(hasRateInModality('av.teacher_id', 'av.modality'));
    expect(sql).toContain(ratedSubjectsJson('u.id'));
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

// Sin Postgres: un cliente falso que anota cada consulta, como en
// db/classes.test.js.
const calls = [];
let handlers = [];

function respond(sql, params) {
  calls.push({ sql, params });
  const handler = handlers.find(([match]) => match.test(sql));
  return Promise.resolve(handler ? handler[1](params) : { rows: [], rowCount: 0 });
}

const client = { query: vi.fn(respond), release: vi.fn() };
const pool = { query: vi.fn(respond), connect: vi.fn(async () => client) };

vi.mock('./pool.js', () => ({ getPool: () => pool }));

const { saveSubmission } = await import('./homework.js');

const ENTREGA = '3f2e1d0c-9b8a-4766-8544-332211009988';
const ALUMNO = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';

const sqls = () => calls.map((c) => c.sql.replace(/\s+/g, ' ').trim());
const indexOf = (re) => sqls().findIndex((sql) => re.test(sql));

afterEach(() => {
  calls.length = 0;
  handlers = [];
  vi.clearAllMocks();
});

describe('saveSubmission', () => {
  const guardada = () => ({ rows: [{ studentId: ALUMNO }], rowCount: 1 });

  it('a late submission loses the on-time credit in the same transaction, under the student lock', async () => {
    handlers = [[/UPDATE homework_submissions/, guardada]];

    expect(await saveSubmission(ENTREGA, { text: 'hecho', linkUrl: null, isLate: true })).toBe(true);

    const begin = indexOf(/^BEGIN$/);
    const update = indexOf(/UPDATE homework_submissions/);
    const lock = indexOf(/hashtext\('neuronas:' \|\| \$1\)/);
    const borrar = indexOf(/DELETE FROM neurona_credits/);
    const commit = indexOf(/^COMMIT$/);
    // Todo adentro de la misma transacción y en este orden.
    expect(begin).toBe(0);
    expect(update).toBeGreaterThan(begin);
    expect(lock).toBeGreaterThan(update);
    expect(borrar).toBeGreaterThan(lock);
    expect(commit).toBeGreaterThan(borrar);
    expect(calls[lock].params).toEqual([ALUMNO]);
    expect(calls[borrar].params).toEqual([ALUMNO, `submission:${ENTREGA}`]);
  });

  it('an on-time submission does not touch the credits', async () => {
    handlers = [[/UPDATE homework_submissions/, guardada]];

    await saveSubmission(ENTREGA, { text: 'hecho', linkUrl: null, isLate: false });

    expect(indexOf(/DELETE FROM neurona_credits/)).toBe(-1);
    expect(sqls()).toContain('COMMIT');
  });

  it('already corrected: nothing is saved nor removed', async () => {
    expect(await saveSubmission(ENTREGA, { text: 'hecho', linkUrl: null, isLate: true })).toBe(false);
    expect(indexOf(/DELETE FROM neurona_credits/)).toBe(-1);
  });

  it('if removing the credit fails, the submission is rolled back too', async () => {
    handlers = [
      [/UPDATE homework_submissions/, guardada],
      [/DELETE FROM neurona_credits/, () => Promise.reject(new Error('boom'))],
    ];

    await expect(
      saveSubmission(ENTREGA, { text: 'hecho', linkUrl: null, isLate: true })
    ).rejects.toThrow('boom');
    expect(sqls()).toContain('ROLLBACK');
    expect(sqls()).not.toContain('COMMIT');
    expect(client.release).toHaveBeenCalled();
  });
});

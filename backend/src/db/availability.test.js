import { afterEach, describe, expect, it, vi } from 'vitest';

// Sin Postgres: se mira qué consulta arma findOverlappingWindow (vía
// updateWindow) y con qué parámetros. La lógica de fechas vive en el SQL, así
// que esto cuida que "hoy" llegue y que el recorte esté en la consulta.
const client = { query: vi.fn(), release: vi.fn() };
vi.mock('./pool.js', () => ({ getPool: () => ({ connect: async () => client }) }));
vi.mock('../lib/clock.js', () => ({
  now: () => ({ iso: '2099-09-07', time: '10:00' }),
  todayIso: () => '2099-09-07',
}));

const { updateWindow } = await import('./availability.js');

const DOCENTE_ID = '9f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f';
const VENTANA_ID = 'f0f0f0f0-0000-4000-8000-000000000001';

// Una semanal que arrancó hace meses, como la deja validateWindow con allowPastDate.
const semanal = {
  date: '2099-03-02',
  repeatsWeekly: true,
  start: '14:00',
  end: '16:00',
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
};

describe('updateWindow overlap check', () => {
  afterEach(() => vi.clearAllMocks());

  it('only compares against dates from today on', async () => {
    client.query.mockImplementation(async (sql) => {
      if (sql.includes('SELECT address_id')) return { rowCount: 1, rows: [{ addressId: null }] };
      if (sql.includes('FROM availability\n     WHERE teacher_id = $1')) {
        return { rowCount: 1, rows: [{ start: '14:00', end: '15:00', repeatsWeekly: false }] };
      }
      return { rowCount: 0, rows: [] };
    });

    const result = await updateWindow(DOCENTE_ID, VENTANA_ID, semanal);
    expect(result.conflict).toMatch(/Se pisa/);

    const [sql, params] = client.query.mock.calls.find(([q]) =>
      q.includes('FROM availability\n     WHERE teacher_id = $1')
    );
    expect(params).toEqual([
      DOCENTE_ID,
      VENTANA_ID,
      '2099-03-02',
      true,
      '14:00',
      '16:00',
      '2099-09-07',
    ]);
    // Una suelta que ya pasó no cuenta, y la semanal nueva solo choca con
    // sueltas desde hoy aunque haya arrancado antes.
    expect(sql).toContain('(repeats_weekly OR start_date >= $7::date)');
    expect(sql).toContain('start_date >= GREATEST($3::date, $7::date)');
  });
});

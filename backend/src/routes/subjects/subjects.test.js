import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../db/subjects.js', () => ({
  listSubjects: vi.fn(),
  countExistingSubjectIds: vi.fn(),
}));

const { listSubjects } = await import('../../db/subjects.js');
const { buildApp } = await import('../../app.js');

describe('GET /api/subjects', () => {
  let app;

  beforeEach(() => {
    app = buildApp({ logger: false });
  });

  afterEach(async () => {
    vi.clearAllMocks();
    await app.close();
  });

  it('returns the subjects catalog', async () => {
    listSubjects.mockResolvedValueOnce([{ id: '1', name: 'Matemática' }]);
    const res = await app.inject({ method: 'GET', url: '/api/subjects' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([{ id: '1', name: 'Matemática' }]);
  });
});

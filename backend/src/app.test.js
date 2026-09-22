import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';

// Ejemplo de referencia: así se prueba una ruta de Fastify sin levantar un
// puerto real. Usá este mismo patrón (buildApp + app.inject) para cada
// endpoint que vayas agregando con TDD.
describe('GET /', () => {
  it('responde con status ok', async () => {
    const app = buildApp({ logger: false });

    const response = await app.inject({ method: 'GET', url: '/' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
  });
});

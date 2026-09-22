import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import csrfProtection from '@fastify/csrf-protection';
import sessionPlugin from './plugins/session.js';
import authRoutes from './routes/auth/index.js';
import subjectsRoutes from './routes/subjects/index.js';
import usersRoutes from './routes/users/index.js';
import teachersRoutes from './routes/teachers/index.js';
import classesRoutes from './routes/classes/index.js';
import availabilityRoutes from './routes/availability/index.js';

/**
 * Arma la app de Fastify, pero no la levanta. Está separado de `index.js`
 * para que los tests puedan importar `buildApp()` y usar `app.inject()`: así
 * no se ocupa ningún puerto real, los tests son rápidos y no se pelean entre
 * ellos por el :4000.
 */
export function buildApp(opts = {}) {
  // trustProxy: Caddy termina el TLS y reenvía por HTTP plano, así que sin
  // esto Fastify ve todos los pedidos como si vinieran de la IP del contenedor
  // de Caddy — y los límites por IP no servirían para nada en producción.
  const app = Fastify({ logger: true, trustProxy: true, ...opts });

  // Tope global. 20/minuto era demasiado poco: abrir el calendario ya pide
  // varias rutas (csrf-token, /me, clases, materias) y navegando un rato
  // normal se llegaba al límite, con el 429 apareciendo como si fuera un
  // error de la app. Las rutas caras siguen con su propio tope más bajo
  // (register y login, 5/minuto, definidos en routes/auth).
  //
  // OJO en dev: todos los pedidos llegan con la IP del contenedor de Vite,
  // no la del usuario, así que TODO el equipo comparte el mismo cupo.
  app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
  });

  app.register(sessionPlugin);
  // La protección CSRF necesita que las cookies estén registradas antes
  // (guarda el secreto en una cookie firmada), así que va después de
  // sessionPlugin.
  app.register(csrfProtection, {
    // path: '/' es necesario, no decorativo. Sin él la cookie queda atada al
    // directorio de la URL que la emitió (/api/auth/), así que no viaja a
    // ninguna otra ruta protegida y el pedido muere con "Missing csrf secret".
    // No se notaba mientras todo lo protegido colgaba de /api/auth.
    cookieOpts: { signed: true, path: '/', sameSite: 'lax' },
  });

  // Los errores que arma Fastify traen internas en inglés ("Missing csrf
  // secret", "Route GET:/x not found") que se mostrarían tal cual en la UI,
  // que es toda en español. Acá se normaliza todo error que las rutas no
  // hayan manejado ellas mismas.
  app.setErrorHandler((error, request, reply) => {
    const status = error.statusCode ?? 500;

    if (status >= 500) {
      request.log.error(error);
      return reply.code(status).send({ message: 'Ocurrió un error inesperado.' });
    }

    const messages = {
      403: 'Tu sesión expiró o el formulario no es válido. Recargá la página.',
      429: 'Demasiados intentos. Esperá un minuto y volvé a intentar.',
    };

    return reply.code(status).send({ message: messages[status] ?? error.message });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.code(404).send({ message: 'Recurso no encontrado' });
  });

  app.get('/', async () => {
    return { status: 'ok' };
  });

  app.register(authRoutes, { prefix: '/api/auth' });
  app.register(subjectsRoutes, { prefix: '/api/subjects' });
  app.register(usersRoutes, { prefix: '/api/users' });
  app.register(teachersRoutes, { prefix: '/api/teachers' });
  app.register(classesRoutes, { prefix: '/api/classes' });
  app.register(availabilityRoutes, { prefix: '/api/availability' });

  return app;
}

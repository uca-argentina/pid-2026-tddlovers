import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findValidSession,
} from '../db/sessions.js';

export const SESSION_COOKIE = 'sid';

// Decora el request con helpers para abrir y cerrar una sesión guardada en la
// base, y agrega `request.user` cuando hay una cookie de sesión válida. Las
// cookies van firmadas, así un `sid` manipulado se rechaza antes de siquiera
// consultar la base.
export default fp(async function sessionPlugin(app) {
  const cookieSecret = process.env.COOKIE_SECRET;
  if (!cookieSecret || cookieSecret.length < 32) {
    throw new Error(
      'COOKIE_SECRET must be set to a string of at least 32 characters (see .env.example)'
    );
  }

  await app.register(fastifyCookie, {
    secret: cookieSecret,
  });

  app.decorateRequest('user', null);

  app.decorate('createUserSession', async function createUserSession(reply, userId) {
    // Limpieza oportunista: no hay cron ni scheduler en este stack, así que
    // las filas vencidas se borran en la escritura que pasa más seguido.
    deleteExpiredSessions().catch((err) => app.log.warn({ err }, 'failed to prune sessions'));

    const session = await createSession(userId);
    reply.setCookie(SESSION_COOKIE, session.id, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      signed: true,
      expires: session.expires_at,
    });
  });

  app.decorate('destroyUserSession', async function destroyUserSession(request, reply) {
    const raw = request.cookies[SESSION_COOKIE];
    if (raw) {
      const unsigned = request.unsignCookie(raw);
      if (unsigned.valid) {
        await deleteSession(unsigned.value);
      }
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
  });

  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid) return;

    const session = await findValidSession(unsigned.value);
    if (session) {
      request.user = { id: session.user_id, email: session.email, role: session.role };
    }
  });

  app.decorate('requireAuth', async function requireAuth(request, reply) {
    if (!request.user) {
      reply.code(401).send({ message: 'No autenticado' });
    }
  });
});

import fp from 'fastify-plugin';
import fastifyCookie from '@fastify/cookie';
import {
  createSession,
  deleteExpiredSessions,
  deleteSession,
  findValidSession,
} from '../db/sessions.js';

// Plugin de sesión: de acá sale `request.user`, que todas las rutas usan para
// saber quién pide (id, rol, estado de aprobación). Las sesiones se guardan en
// la tabla `sessions` (db/sessions.js) y el navegador solo tiene el id en la
// cookie firmada `sid`. Lo registra app.js antes de la protección CSRF.

const SESSION_COOKIE = 'sid';

/**
 * Registra @fastify/cookie y agrega a la app:
 * - `app.createUserSession(reply, userId)` y `app.destroyUserSession(request, reply)`,
 *   que usan login/register/logout (routes/auth/index.js);
 * - `app.requireAuth`, el hook que exige sesión (lo usan todas las rutas de
 *   routes/* que no son públicas);
 * - un hook onRequest que, si la cookie es válida, carga `request.user`.
 *
 * Las cookies van firmadas, así un `sid` manipulado se rechaza antes de siquiera
 * consultar la base. Exige COOKIE_SECRET (variable de entorno, ≥32 caracteres):
 * sin él la app no arranca.
 *
 * Va envuelto en fastify-plugin (fp) para que los decorados queden visibles en
 * toda la app y no solo adentro de este plugin.
 */
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

  /**
   * Abre una sesión: inserta una fila en `sessions` (createSession, vence a los
   * 7 días) y manda la cookie `sid` firmada con ese id.
   *
   * @param {import('fastify').FastifyReply} reply - la respuesta donde se pone la cookie.
   * @param {string} userId - id del usuario recién registrado o logueado (sale de
   *   la fila de users que leyó o insertó la ruta).
   * Lo usan: routes/auth/index.js (register y login).
   */
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

  /**
   * Cierra la sesión: si la cookie `sid` es válida borra su fila de `sessions`
   * (deleteSession) y, en cualquier caso, borra la cookie del navegador.
   *
   * @param {import('fastify').FastifyRequest} request - de donde sale la cookie.
   * @param {import('fastify').FastifyReply} reply - donde se limpia la cookie.
   * Lo usa: routes/auth/index.js (logout).
   */
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

  // En cada pedido: si viene una cookie `sid` bien firmada y su sesión no
  // venció (findValidSession: sessions JOIN users), arma `request.user` =
  // { id, email, role, approvalStatus }. Si no, queda en null y requireAuth
  // contesta 401. Como el rol y el estado de aprobación se leen de la base en
  // cada pedido, un docente aprobado o rechazado lo nota sin volver a loguearse.
  app.addHook('onRequest', async (request) => {
    const raw = request.cookies[SESSION_COOKIE];
    if (!raw) return;

    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid) return;

    const session = await findValidSession(unsigned.value);
    if (session) {
      request.user = {
        id: session.user_id,
        email: session.email,
        role: session.role,
        approvalStatus: session.approval_status ?? null,
      };
    }
  });

  // Hook de las rutas privadas (`{ onRequest: [app.requireAuth] }` en
  // routes/*): sin `request.user` corta con 401 antes de llegar al handler.
  app.decorate('requireAuth', async function requireAuth(request, reply) {
    if (!request.user) {
      reply.code(401).send({ message: 'No autenticado' });
    }
  });
});

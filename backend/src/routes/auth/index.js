import { createUser, findUserByEmail, findUserById } from '../../db/users.js';
import { countExistingSubjectIds } from '../../db/subjects.js';
import { checkPasswordStrength, hashPassword, verifyPassword } from '../../lib/password.js';
import { toPublicUser } from '../../lib/publicUser.js';
import { isUuid } from '../../lib/validators.js';

// Rutas de autenticación, montadas en /api/auth (app.js):
//   GET  /api/auth/csrf-token  cualquiera
//   POST /api/auth/register    cualquiera (CSRF; 5/min) — solo teacher/student
//   POST /api/auth/login       cualquiera (CSRF; 5/min)
//   POST /api/auth/logout      cualquiera (CSRF)
//   GET  /api/auth/me          con sesión (cualquier rol)
// Usa: db/users.js, db/subjects.js, lib/password.js, lib/publicUser.js y la
// sesión de plugins/session.js (app.createUserSession / destroyUserSession).
// Los errores salen como { message } (+ `fields` en validaciones); no hay código `error`.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// En inglés, como el resto del código: son los valores que viajan por la API
// y los que guarda el enum user_role de la base. El frontend manda estos dos
// (ver CLAUDE.md en la raíz); lo que el usuario ve en pantalla se traduce allá.
const ROLES = ['teacher', 'student'];

export default async function authRoutes(app) {
  // El cliente pega acá primero para conseguir un token, y después lo manda
  // en el header `x-csrf-token` en register/login/logout.
  // Respuesta: 200 { csrfToken }.
  app.get('/csrf-token', async (request, reply) => {
    return reply.send({ csrfToken: await reply.generateCsrf() });
  });

  /**
   * Alta de usuario + sesión. Un docente nace 'pending'.
   *
   * Body: { email, password, role: 'teacher'|'student', nombre, apellido,
   *   telefono?, subjectIds? (solo docentes) }.
   * Respuesta: 201 + usuario de toPublicUser; setea la cookie de sesión.
   * Errores: 400 (email, rol, nombre, apellido, contraseña débil o materias
   *   inválidas, con `fields`), 409 email ya registrado ({ fields: { email: 'taken' } }).
   */
  app.post(
    '/register',
    {
      onRequest: app.csrfProtection,
      // El registro corre un hash argon2id a propósito lento en cada pedido,
      // así que necesita un tope más bajo que el límite global.
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const {
        email,
        password,
        role,
        nombre,
        apellido,
        telefono,
        subjectIds = [],
      } = request.body ?? {};

      if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
        return reply.code(400).send({ message: 'Email inválido', fields: { email: 'invalid' } });
      }
      if (!ROLES.includes(role)) {
        return reply.code(400).send({ message: 'Rol inválido', fields: { role: 'invalid' } });
      }
      if (typeof nombre !== 'string' || !nombre.trim()) {
        return reply
          .code(400)
          .send({ message: 'El nombre es obligatorio', fields: { nombre: 'required' } });
      }
      if (typeof apellido !== 'string' || !apellido.trim()) {
        return reply
          .code(400)
          .send({ message: 'El apellido es obligatorio', fields: { apellido: 'required' } });
      }

      const strengthError = checkPasswordStrength(password);
      if (strengthError) {
        return reply.code(400).send({ message: strengthError, fields: { password: 'weak' } });
      }

      let cleanSubjectIds = [];
      if (role === 'teacher') {
        cleanSubjectIds = Array.isArray(subjectIds) ? [...new Set(subjectIds)] : [];
        // Un id que no es UUID llegaría a `$1::uuid[]` y sería un 500.
        if (!cleanSubjectIds.every(isUuid)) {
          return reply.code(400).send({
            message: 'Una o más materias seleccionadas no existen',
            fields: { subjectIds: 'invalid' },
          });
        }
        if (cleanSubjectIds.length > 0) {
          const validCount = await countExistingSubjectIds(cleanSubjectIds);
          if (validCount !== cleanSubjectIds.length) {
            return reply.code(400).send({
              message: 'Una o más materias seleccionadas no existen',
              fields: { subjectIds: 'invalid' },
            });
          }
        }
      }

      const normalizedEmail = email.toLowerCase();
      const existing = await findUserByEmail(normalizedEmail);
      if (existing) {
        return reply
          .code(409)
          .send({ message: 'Ya existe una cuenta con ese email', fields: { email: 'taken' } });
      }

      const passwordHash = await hashPassword(password);
      const user = await createUser({
        email: normalizedEmail,
        passwordHash,
        role,
        nombre: nombre.trim(),
        apellido: apellido.trim(),
        telefono: typeof telefono === 'string' && telefono.trim() ? telefono.trim() : null,
        subjectIds: cleanSubjectIds,
      });

      await app.createUserSession(reply, user.id);

      return reply.code(201).send(await toPublicUser(user));
    }
  );

  /**
   * Login con email y contraseña.
   *
   * Body: { email, password }.
   * Respuesta: 200 + usuario de toPublicUser; setea la cookie de sesión.
   * Errores: 400 faltan datos, 401 credenciales inválidas.
   */
  app.post(
    '/login',
    {
      onRequest: app.csrfProtection,
      config: {
        rateLimit: { max: 5, timeWindow: '1 minute' },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body ?? {};

      if (typeof email !== 'string' || typeof password !== 'string') {
        return reply.code(400).send({ message: 'Email y contraseña son requeridos' });
      }

      const user = await findUserByEmail(email.toLowerCase());
      // El mismo error para "no existe el usuario" y "contraseña incorrecta",
      // así no se filtra qué emails están registrados.
      if (!user || !(await verifyPassword(user.password_hash, password))) {
        return reply.code(401).send({ message: 'Credenciales inválidas' });
      }

      await app.createUserSession(reply, user.id);

      return reply.send(await toPublicUser(user));
    }
  );

  /** Borra la sesión y la cookie. Respuesta: 204. */
  app.post('/logout', { onRequest: app.csrfProtection }, async (request, reply) => {
    await app.destroyUserSession(request, reply);
    return reply.code(204).send();
  });

  // Devuelve el usuario completo, no el `request.user` de la sesión (que solo
  // trae id, email y rol): el front lo usa para recuperar la sesión al
  // refrescar, y ahí necesita los mismos campos que devuelve el login.
  // Origen: request.user.id → findUserById. Respuesta: 200 usuario; 401 sin sesión.
  app.get('/me', { onRequest: app.requireAuth }, async (request, reply) => {
    const user = await findUserById(request.user.id);
    if (!user) {
      return reply.code(401).send({ message: 'No autenticado' });
    }
    return reply.send(await toPublicUser(user));
  });
}

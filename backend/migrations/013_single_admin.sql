-- Una sola cuenta de administrador, fija, y ninguna otra.
--
--   email:      admin@admin.com
--   contraseña: ElAdmin123.   (con el punto final: cumple las mismas reglas
--                              que el registro, ver lib/password.js)
--
-- Decisión del equipo: el admin decide qué docentes aparecen en la app, así
-- que no se puede crear desde el registro (solo acepta teacher/student) ni de
-- ninguna otra forma. La cuenta se crea acá, con el hash argon2id ya
-- calculado (Postgres no sabe calcular argon2), y la base impide que exista
-- un segundo admin aunque alguien haga un INSERT a mano.
--
-- Idempotente. Correr a mano:
--   psql "$DATABASE_URL" -f migrations/013_single_admin.sql

-- Si quedó algún admin creado antes con otro mail (con el script
-- create-admin, que ya no existe), se borra: si no, las restricciones de
-- abajo no se podrían crear. Los admins no tienen clases ni materias; lo
-- único que los referencia es approval_reviewed_by, que queda en NULL.
DELETE FROM users WHERE role = 'admin' AND email <> 'admin@admin.com';

-- Si ese mail ya lo usaba otra cuenta (alumno o docente), mejor que falle y
-- avise a convertirla en admin en silencio.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE email = 'admin@admin.com' AND role <> 'admin') THEN
    RAISE EXCEPTION 'admin@admin.com ya lo usa una cuenta que no es admin: borrala o cambiale el mail antes de correr esta migración';
  END IF;
END $$;

INSERT INTO users (email, password_hash, role, nombre, apellido)
VALUES (
  'admin@admin.com',
  '$argon2id$v=19$m=65536,p=4,t=3$rikgRcA7Wgy1jXJVTP+XLQ$Jtfz3L/x1eCEF/Jxk1DwHJONTNggJ9vjvjvumMd0gWY',
  'admin',
  'Admin',
  'BookIt'
)
-- DO UPDATE y no DO NOTHING: si la contraseña fija cambia, volver a correr
-- esta migración la actualiza. El DO de arriba ya garantiza que, si el mail
-- existe, es del admin.
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- El rol admin solo puede tenerlo admin@admin.com...
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_admin_is_fixed;
ALTER TABLE users ADD CONSTRAINT users_admin_is_fixed CHECK (
  role <> 'admin' OR email = 'admin@admin.com'
);

-- ...y no puede haber más de uno. Con el CHECK de arriba ya lo garantiza el
-- UNIQUE del email, pero esto lo deja dicho explícitamente y no depende de
-- que alguien afloje el CHECK algún día.
CREATE UNIQUE INDEX IF NOT EXISTS users_single_admin_idx ON users (role) WHERE role = 'admin';

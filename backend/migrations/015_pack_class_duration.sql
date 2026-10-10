-- Los paquetes pasan a tener una duración fija por clase.
--
--   - El docente decide cuánto dura cada clase del paquete ("8 clases de 1 h").
--     Se copia al paquete comprado, como la cantidad y el precio.
--   - Al reservar, el alumno elige cuántas clases del paquete usa (una o más)
--     y la duración de la clase como siempre. Lo que cubren las clases del
--     paquete no se paga; lo que se pasa de eso se paga aparte con la tarifa
--     de la materia ("1 clase de 1 h + 30 min a $ 5.000/h" para una clase de
--     1 h 30 min). Las clases del paquete no pueden cubrir más que la clase.
--   - Cada asistencia descuenta las clases del paquete que usó esa reserva
--     (classes.pack_tokens), no siempre una.
--
-- Los paquetes que ya existían quedan con clases de 1 h, y las reservas que
-- ya los usaban, con 1 clase cada una (lo que valía con la regla anterior).
--
-- Idempotente. Correr a mano, después de la 014:
--   psql "$DATABASE_URL" -f migrations/015_pack_class_duration.sql

-- --- class_packs / student_packs -------------------------------------------

ALTER TABLE class_packs ADD COLUMN IF NOT EXISTS class_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE class_packs ALTER COLUMN class_minutes DROP DEFAULT;

-- Mismo mínimo que una clase, y de a 5 minutos como la duración que elige el
-- alumno. El techo (4 h) es de sentido común.
ALTER TABLE class_packs DROP CONSTRAINT IF EXISTS class_packs_minutes_valid;
ALTER TABLE class_packs ADD CONSTRAINT class_packs_minutes_valid CHECK (
  class_minutes BETWEEN 30 AND 240 AND class_minutes % 5 = 0
);

ALTER TABLE student_packs ADD COLUMN IF NOT EXISTS class_minutes INTEGER NOT NULL DEFAULT 60;
ALTER TABLE student_packs ALTER COLUMN class_minutes DROP DEFAULT;

-- --- classes ---------------------------------------------------------------

-- Cuántas clases del paquete usa la reserva. 0 = no usa paquete.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS pack_tokens INTEGER NOT NULL DEFAULT 0;

UPDATE classes SET pack_tokens = 1 WHERE student_pack_id IS NOT NULL AND pack_tokens = 0;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_pack_tokens_valid;
ALTER TABLE classes ADD CONSTRAINT classes_pack_tokens_valid CHECK (
  (student_pack_id IS NULL AND pack_tokens = 0)
  OR (student_pack_id IS NOT NULL AND pack_tokens > 0)
);

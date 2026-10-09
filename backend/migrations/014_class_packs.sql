-- Paquetes de clases.
--
--   - El docente publica paquetes: cuántas clases, el precio total y cuántos
--     días dura desde que se compra ("4 clases, $ 18.000, 30 días").
--   - El alumno compra uno: queda una fila en student_packs con una COPIA de
--     la cantidad y el precio (si el docente cambia el paquete después, lo
--     que el alumno ya compró no se mueve) y la fecha de vencimiento.
--   - Sirve para cualquier clase de ese docente: el alumno elige materia,
--     modalidad y duración al reservar, como siempre. La clase queda atada al
--     paquete (classes.student_pack_id) y no se paga aparte.
--   - Cada asistencia (clase 'realizada') descuenta una clase del paquete. Lo
--     que queda NO se guarda como contador: se cuenta a partir de las clases,
--     así corregir una asistencia (realizada → no_presentada) o cancelar una
--     reserva lo devuelve solo, sin que nada se desincronice. Las reglas viven
--     en src/lib/classPacks.js.
--
-- Nada se cobra de verdad: comprar un paquete solo lo registra, igual que
-- POST /api/classes/:id/pay.
--
-- Idempotente. Correr a mano:
--   psql "$DATABASE_URL" -f migrations/014_class_packs.sql

CREATE TABLE IF NOT EXISTS class_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_count INTEGER NOT NULL,
  -- En centavos, como las tarifas. 0 = sin cargo.
  price_cents INTEGER NOT NULL,
  validity_days INTEGER NOT NULL,
  -- Un paquete que ya alguien compró no se borra (student_packs lo
  -- referencia): el docente lo deja de ofrecer.
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Los techos son de sentido común, no del negocio: frenan un typo.
  CONSTRAINT class_packs_count_valid CHECK (class_count BETWEEN 2 AND 100),
  CONSTRAINT class_packs_price_valid CHECK (price_cents BETWEEN 0 AND 1000000000),
  CONSTRAINT class_packs_validity_valid CHECK (validity_days BETWEEN 1 AND 365)
);

CREATE INDEX IF NOT EXISTS class_packs_teacher_idx ON class_packs (teacher_id) WHERE active;

CREATE TABLE IF NOT EXISTS student_packs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id UUID NOT NULL REFERENCES class_packs(id) ON DELETE RESTRICT,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Redundante con el del paquete, pero es por lo que se busca siempre
  -- ("¿qué paquete tengo con este docente?").
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_count INTEGER NOT NULL,
  price_cents INTEGER NOT NULL,
  purchased_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- El último día en que se puede tomar una clase con el paquete (incluido).
  expires_on DATE NOT NULL,

  CONSTRAINT student_packs_count_valid CHECK (class_count > 0),
  CONSTRAINT student_packs_price_valid CHECK (price_cents >= 0)
);

CREATE INDEX IF NOT EXISTS student_packs_student_teacher_idx
  ON student_packs (student_id, teacher_id);

-- La clase sabe con qué paquete se reservó. SET NULL y no CASCADE: si algún
-- día se borra un paquete, la clase (y su historial) queda.
ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS student_pack_id UUID REFERENCES student_packs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS classes_student_pack_idx
  ON classes (student_pack_id) WHERE student_pack_id IS NOT NULL;

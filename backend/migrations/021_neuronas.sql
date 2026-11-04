-- Neuronas: los puntos que suman alumnos y docentes y se canjean por premios.
--
--   - El saldo no se guarda: es lo acreditado menos los canjes de clases no
--     canceladas menos los Destacados. Igual que lo que queda de un paquete,
--     así cancelar una clase devuelve su canje sin ningún paso extra.
--   - neurona_credits tiene una fila por lo que acredita (source_key). Corregir
--     una asistencia la actualiza o la borra, y el UNIQUE impide pagar dos
--     veces lo mismo. Las de docente y alumno por la misma entrega comparten
--     clave, por eso el UNIQUE incluye al usuario.
--   - accepts_neurona_rewards arranca en false: la app no cobra, así que una
--     clase canjeada la absorbe el docente, y tiene que haberlo elegido.
--
-- Idempotente. Correr a mano, después de la 020:
--   psql "$DATABASE_URL" -f migrations/021_neuronas.sql

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS accepts_neurona_rewards BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE classes
  ADD COLUMN IF NOT EXISTS reward_type TEXT,
  ADD COLUMN IF NOT EXISTS reward_neuronas INT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_reward_valid') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_reward_valid CHECK (
      (reward_type IS NULL AND reward_neuronas = 0)
      OR (
        reward_type IN ('free_30', 'free_60', 'discount_10', 'discount_20')
        AND reward_neuronas > 0
      )
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'classes_reward_or_pack') THEN
    ALTER TABLE classes ADD CONSTRAINT classes_reward_or_pack CHECK (
      reward_type IS NULL OR student_pack_id IS NULL
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS neurona_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  source_key TEXT NOT NULL,
  amount INT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  -- El día en que cuenta para los topes: el de la clase, o el de la corrección.
  earned_on DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT neurona_credits_unique_source UNIQUE (user_id, source_key),
  CONSTRAINT neurona_credits_amount_positive CHECK (amount > 0),
  CONSTRAINT neurona_credits_reason_valid CHECK (
    reason IN (
      'class_attended',
      'class_taught',
      'homework_on_time',
      'homework_feedback',
      'reward_bonus'
    )
  )
);

CREATE INDEX IF NOT EXISTS neurona_credits_user_day_idx
  ON neurona_credits (user_id, reason, earned_on);

CREATE TABLE IF NOT EXISTS teacher_featured (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  cost_neuronas INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT teacher_featured_dates CHECK (end_date >= start_date),
  CONSTRAINT teacher_featured_cost_positive CHECK (cost_neuronas > 0)
);

CREATE INDEX IF NOT EXISTS teacher_featured_dates_idx
  ON teacher_featured (end_date, teacher_id);

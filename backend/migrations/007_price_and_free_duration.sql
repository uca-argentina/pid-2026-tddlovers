-- Dos cambios de requerimiento sobre las ventanas de 006:
--
--   1. Cada clase tiene precio, que el docente decide al cargar la ventana.
--      En pesos enteros, por alumno y por clase; 0 es sin cargo. Se copia a
--      la clase al reservar (igual que la modalidad): si el docente cambia el
--      precio después, lo que el alumno ya reservó no se mueve.
--
--   2. La duración de la clase es libre (45 min, 50 min, 1 h 15...), ya no de
--      a media hora. El mínimo de 30 min se mantiene, y las clases siguen
--      ARRANCANDO en :00 o :30 — pero ahora pueden terminar en cualquier
--      minuto (13:00 + 45 min = 13:45).
--
-- Idempotente. Correr a mano:
--   psql "$DATABASE_URL" -f migrations/007_price_and_free_duration.sql

-- --- availability -----------------------------------------------------------

-- Las ventanas que ya existían quedan en 0 (sin cargo); el DEFAULT se saca
-- después para que ninguna ventana nueva se guarde sin precio por olvido.
ALTER TABLE availability ADD COLUMN IF NOT EXISTS price INTEGER NOT NULL DEFAULT 0;
ALTER TABLE availability ALTER COLUMN price DROP DEFAULT;

-- El techo es de sentido común, no del negocio: frena un typo con ceros de más.
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_price_valid;
ALTER TABLE availability ADD CONSTRAINT availability_price_valid CHECK (
  price BETWEEN 0 AND 10000000
);

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_duration_valid;
ALTER TABLE availability ADD CONSTRAINT availability_duration_valid CHECK (
  duration_minutes >= 30
  AND make_interval(mins => duration_minutes) <= end_time - start_time
);

-- --- classes ----------------------------------------------------------------

-- Nulo en las clases de antes de que existiera el precio.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS price INTEGER;

-- El fin ya no cae en :00/:30. El inicio sí (classes_half_hour_aligned, de
-- 004, sigue vigente).
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_duration_valid;
ALTER TABLE classes ADD CONSTRAINT classes_duration_valid CHECK (
  end_time - start_time >= INTERVAL '30 minutes'
  AND EXTRACT(SECOND FROM end_time) = 0
);

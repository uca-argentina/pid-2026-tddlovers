-- Docentes favoritos del alumno.
--
--   - El alumno marca docentes como favoritos desde las tarjetas del tablero
--     o desde sus reservas, y los ve en "Mis favoritos" y con el filtro
--     "Solo favoritos" del tablero.
--   - Es privado: el docente no ve quién lo tiene en favoritos.
--   - Si el docente deja de estar aprobado, el favorito se conserva pero no se
--     muestra (la ruta filtra por approval_status); si lo vuelven a aprobar,
--     reaparece solo.
--
-- Que student_id sea alumno y teacher_id docente lo chequea la ruta: un CHECK
-- no puede mirar otra tabla, y un trigger es mucho para esto.
--
-- Idempotente. Correr a mano, después de la 016:
--   psql "$DATABASE_URL" -f migrations/017_favorite_teachers.sql

CREATE TABLE IF NOT EXISTS favorite_teachers (
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Marcar dos veces no duplica: la ruta hace ON CONFLICT DO NOTHING.
  PRIMARY KEY (student_id, teacher_id)
);

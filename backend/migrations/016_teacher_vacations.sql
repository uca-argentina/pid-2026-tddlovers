-- Vacaciones del docente.
--
--   - El docente carga uno o más rangos de fechas (desde/hasta, los dos
--     días incluidos) en los que no da clases. Los puede borrar si se
--     equivocó.
--   - Mientras dura, sus ventanas siguen guardadas pero no se pueden
--     reservar: el alumno las ve en gris con "El docente está de vacaciones",
--     y el docente también las ve marcadas en su semana.
--   - Al cargarlas, las reservas que ya tenía esos días (pendientes,
--     aceptadas o confirmadas, que todavía no empezaron) se cancelan con
--     motivo 'vacaciones'. Borrar las vacaciones NO las revive: el alumno ya
--     se enteró y pudo reservar otra cosa.
--
-- Las reglas viven en src/lib/vacations.js.
--
-- Idempotente. Correr a mano, después de la 015:
--   psql "$DATABASE_URL" -f migrations/016_teacher_vacations.sql

CREATE TABLE IF NOT EXISTS teacher_vacations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Los dos incluidos: "del 1 al 15 de enero" son 15 días.
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT teacher_vacations_range_valid CHECK (start_date <= end_date)
);

-- Dos rangos del mismo docente no se pisan: si se pisaran, borrar uno dejaría
-- días de vacaciones a medias. La ruta lo avisa antes; esto es la última red.
-- '[]' porque los dos extremos son días de vacaciones.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE teacher_vacations DROP CONSTRAINT IF EXISTS teacher_vacations_no_overlap;
ALTER TABLE teacher_vacations ADD CONSTRAINT teacher_vacations_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );

-- Una reserva cancelada por las vacaciones del docente lo dice: el alumno ve
-- "El docente está de vacaciones" y no un "La canceló el docente" pelado.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_cancel_reason_valid;
ALTER TABLE classes ADD CONSTRAINT classes_cancel_reason_valid CHECK (
  cancel_reason IS NULL
  OR cancel_reason IN ('rechazada', 'cancelada', 'vencida', 'reprogramada', 'vacaciones')
);

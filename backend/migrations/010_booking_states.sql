-- Estados de las reservas. Antes una clase estaba 'reservada' o 'cancelada';
-- ahora tiene un ciclo de vida:
--
--   pendiente     el alumno reservó y el docente todavía no respondió
--   aceptada      el docente la aceptó; falta que el alumno pague
--   confirmada    aceptada y pagada
--   realizada     el docente tomó lista y el alumno estuvo
--   no_presentada el docente tomó lista y el alumno no vino
--   cancelada     la canceló alguno de los dos, venció sin respuesta, o se
--                 reprogramó (ver cancel_reason)
--
-- Las reglas de quién pasa de qué estado a cuál viven en
-- src/lib/classStates.js: dependen de la hora actual (la regla de 24 h), y
-- eso no se escribe bien en un CHECK.
--
-- Las reservas que ya existen pasan a pendiente: nadie las aceptó todavía.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/010_booking_states.sql

-- RENAME VALUE falla si el valor ya no existe, así que se hace solo la
-- primera vez: así la migración se puede volver a correr.
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'class_status' AND e.enumlabel = 'reservada'
  ) THEN
    ALTER TYPE class_status RENAME VALUE 'reservada' TO 'pendiente';
  END IF;
END $$;

ALTER TYPE class_status ADD VALUE IF NOT EXISTS 'aceptada';
ALTER TYPE class_status ADD VALUE IF NOT EXISTS 'confirmada';
ALTER TYPE class_status ADD VALUE IF NOT EXISTS 'realizada';
ALTER TYPE class_status ADD VALUE IF NOT EXISTS 'no_presentada';

ALTER TABLE classes ALTER COLUMN status SET DEFAULT 'pendiente';

ALTER TABLE classes
  -- El pago va aparte del estado: una clase puede quedar realizada o no
  -- presentada y todavía deber el pago (se puede pagar después de la clase).
  ADD COLUMN IF NOT EXISTS paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
  -- Quién y por qué, para mostrar "Rechazada por el docente" o
  -- "Reprogramada" en vez de un "Cancelada" pelado.
  ADD COLUMN IF NOT EXISTS cancelled_by user_role,
  ADD COLUMN IF NOT EXISTS cancel_reason TEXT,
  -- La reserva nueva de una reprogramación apunta a la que reemplaza.
  ADD COLUMN IF NOT EXISTS rescheduled_from UUID REFERENCES classes(id) ON DELETE SET NULL;

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_cancel_reason_valid;
ALTER TABLE classes ADD CONSTRAINT classes_cancel_reason_valid CHECK (
  cancel_reason IS NULL OR cancel_reason IN ('rechazada', 'cancelada', 'vencida', 'reprogramada')
);

-- Todo lo que no está cancelado ocupa el horario, pendiente incluida: si no,
-- dos alumnos podrían pedir el mismo turno mientras el docente no responde.
-- Mismas restricciones que 004/006, cambia solo el WHERE.
ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_teacher_no_overlap;
ALTER TABLE classes ADD CONSTRAINT classes_teacher_no_overlap
  EXCLUDE USING gist (
    teacher_id WITH =,
    class_date WITH =,
    timerange(start_time, end_time, '[)') WITH &&,
    start_time WITH <>
  ) WHERE (status <> 'cancelada');

ALTER TABLE classes DROP CONSTRAINT IF EXISTS classes_student_no_overlap;
ALTER TABLE classes ADD CONSTRAINT classes_student_no_overlap
  EXCLUDE USING gist (
    student_id WITH =,
    class_date WITH =,
    timerange(start_time, end_time, '[)') WITH &&
  ) WHERE (status <> 'cancelada');

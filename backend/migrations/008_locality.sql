-- La ubicación de las clases presenciales (e híbridas) pasa a tener dos
-- niveles:
--   - `locality`: la zona general ("Palermo, CABA"). La ven todos los
--     alumnos en el tablero, para decidir si les queda cerca.
--   - `address`: la dirección exacta. Solo la ve el alumno que reservó (se
--     copia a la clase al reservar, igual que el link de las virtuales).
--
-- Las ventanas que ya existían no tienen localidad, y no se completa con la
-- dirección: sería publicar justo lo que se quiere esconder. Por eso el CHECK
-- va NOT VALID: no se revisa contra esas filas viejas, pero sí contra toda
-- fila nueva o editada — el docente la completa la próxima vez que la edite.
--
-- Idempotente. Correr a mano:
--   psql "$DATABASE_URL" -f migrations/008_locality.sql

ALTER TABLE availability ADD COLUMN IF NOT EXISTS locality TEXT;

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_locality_valid;
ALTER TABLE availability ADD CONSTRAINT availability_locality_valid CHECK (
  modality = 'virtual' OR locality IS NOT NULL
) NOT VALID;

-- La clase se lleva las dos: el alumno que reservó ve la dirección exacta, y
-- la localidad sirve de referencia si el docente cambia la ventana después.
ALTER TABLE classes ADD COLUMN IF NOT EXISTS locality TEXT;

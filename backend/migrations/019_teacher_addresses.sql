-- Direcciones del docente.
--
--   - El docente guarda sus direcciones (Casa, Escuela...) en el perfil y una
--     puede ser la predeterminada: es la que viene elegida al crear una
--     ventana presencial o híbrida.
--   - La ventana APUNTA a una dirección (address_id): si el docente edita
--     "Casa", cambian todas las ventanas que la usan. Por eso no se puede
--     borrar una dirección en uso (FK con RESTRICT).
--   - Una ventana puede usar una dirección que no se guardó: es una fila con
--     saved = false, que no aparece en el perfil y se borra cuando ninguna
--     ventana la usa (db/availability.js).
--   - La clase NO apunta acá: al reservar se copia la dirección armada en
--     classes.address y la localidad en classes.locality (como siempre), así
--     que editar o borrar una dirección no mueve nada de lo ya reservado.
--   - `locality` es lo único que ve el alumno antes de pagar (tablero, clase
--     sin pagar); el resto, recién cuando pagó.
--
-- Las ventanas presenciales e híbridas que había guardaban la dirección como
-- texto libre, que no se puede partir en calle/número/etc. Eran datos de
-- prueba: se borran. Las clases ya reservadas conservan su copia
-- (classes.availability_id queda en NULL).
--
-- Idempotente. Correr a mano, después de la 018:
--   psql "$DATABASE_URL" -f migrations/019_teacher_addresses.sql

CREATE TABLE IF NOT EXISTS teacher_addresses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Cómo la llama el docente. Una dirección suelta (no guardada) no tiene.
  label TEXT,
  street TEXT NOT NULL,
  number TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  locality TEXT NOT NULL,
  city TEXT NOT NULL,
  floor TEXT,
  apartment TEXT,
  notes TEXT,
  saved BOOLEAN NOT NULL DEFAULT true,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Para la FK compuesta de availability: la dirección tiene que ser del
  -- mismo docente que la ventana.
  CONSTRAINT teacher_addresses_id_teacher UNIQUE (id, teacher_id),
  CONSTRAINT teacher_addresses_label_valid
    CHECK (NOT saved OR char_length(btrim(label)) BETWEEN 1 AND 40),
  CONSTRAINT teacher_addresses_required_valid CHECK (
    char_length(btrim(street)) BETWEEN 1 AND 120
    AND char_length(btrim(number)) BETWEEN 1 AND 10
    AND char_length(btrim(postal_code)) BETWEEN 1 AND 10
    AND char_length(btrim(locality)) BETWEEN 1 AND 100
    AND char_length(btrim(city)) BETWEEN 1 AND 100
  ),
  CONSTRAINT teacher_addresses_optional_valid CHECK (
    (floor IS NULL OR char_length(floor) BETWEEN 1 AND 10)
    AND (apartment IS NULL OR char_length(apartment) BETWEEN 1 AND 10)
    AND (notes IS NULL OR char_length(notes) BETWEEN 1 AND 200)
  ),
  -- Una suelta no puede ser la predeterminada: no aparece en el perfil.
  CONSTRAINT teacher_addresses_default_is_saved CHECK (NOT is_default OR saved)
);

-- Como mucho una predeterminada por docente.
CREATE UNIQUE INDEX IF NOT EXISTS teacher_addresses_one_default
  ON teacher_addresses (teacher_id) WHERE is_default;

-- Datos de prueba con la dirección vieja en texto libre (ver arriba).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'availability' AND column_name = 'address'
  ) THEN
    DELETE FROM availability WHERE modality <> 'virtual';
  END IF;
END $$;

ALTER TABLE availability ADD COLUMN IF NOT EXISTS address_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'availability_address_fkey'
  ) THEN
    ALTER TABLE availability
      ADD CONSTRAINT availability_address_fkey
      FOREIGN KEY (address_id, teacher_id)
      REFERENCES teacher_addresses (id, teacher_id) ON DELETE RESTRICT;
  END IF;
END $$;

ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_locality_valid;
ALTER TABLE availability DROP CONSTRAINT IF EXISTS availability_location_valid;
ALTER TABLE availability DROP COLUMN IF EXISTS address;
ALTER TABLE availability DROP COLUMN IF EXISTS locality;

-- Virtual: link. Presencial: dirección. Híbrida: las dos.
ALTER TABLE availability ADD CONSTRAINT availability_location_valid CHECK (
  (modality = 'in_person' OR meeting_url IS NOT NULL)
  AND (modality = 'virtual' OR address_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS availability_address_idx
  ON availability (address_id) WHERE address_id IS NOT NULL;

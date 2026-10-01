-- El tipo week_day quedó huérfano: lo usaba solo availability.day_key, que
-- 006 borró porque el día de la semana sale de la fecha. Los días siguen
-- existiendo como texto ('lunes' … 'domingo') en el código, no en la base.
--
-- Sin CASCADE a propósito: si alguna base todavía tiene una columna de este
-- tipo (porque no corrió la 006), mejor que falle y avise a que la borre en
-- silencio junto con sus datos.
--
-- Correr a mano: psql "$DATABASE_URL" -f migrations/011_drop_week_day.sql

DROP TYPE IF EXISTS week_day;

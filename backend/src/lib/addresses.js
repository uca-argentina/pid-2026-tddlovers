// Las direcciones del docente: qué campos tienen, cuáles son obligatorios y
// cómo se arma la línea que se copia a la clase. La UI valida lo mismo
// (frontend/src/utils/addresses.js), pero la UI se puede saltear.
//
// `locality` es lo que ve cualquier alumno (el tablero, una clase sin pagar);
// el resto es la dirección exacta, que el alumno ve recién cuando pagó.
//
// Tabla: teacher_addresses (migración 019). Lo usan routes/teachers/index.js
// (CRUD de /me/addresses), lib/availabilityWindow.js (dirección nueva cargada
// en una ventana) y db/bookings.js (formatAddress al reservar).
// Espejo: frontend/src/utils/addresses.js (addressErrors, formatAddress).

// Los mismos topes que los CHECK de la migración 019. `label` es el texto que
// se usa en el mensaje de error ("Falta la calle.").
const FIELDS = [
  { key: 'street', label: 'la calle', max: 120, required: true },
  { key: 'number', label: 'el número', max: 10, required: true },
  { key: 'postalCode', label: 'el código postal', max: 10, required: true },
  { key: 'locality', label: 'la localidad', max: 100, required: true },
  { key: 'city', label: 'la ciudad', max: 100, required: true },
  { key: 'floor', label: 'el piso', max: 10, required: false },
  { key: 'apartment', label: 'el departamento', max: 10, required: false },
  { key: 'notes', label: 'el detalle', max: 200, required: false },
];

const MAX_LABEL_LENGTH = 40;

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Valida y normaliza una dirección (sin espacios de más, los opcionales vacíos
 * en null). El nombre ("Casa") solo es obligatorio si se guarda: una dirección
 * suelta de una ventana no lo necesita.
 *
 * @param {object} body - { label, street, number, postalCode, locality, city,
 *   floor?, apartment?, notes? }: el body de POST/PUT /api/teachers/me/addresses,
 *   o el `address` que viene adentro del body de una ventana.
 * @param {{saving: boolean}} opts - `saving` true si va a quedar guardada en el
 *   perfil (siempre en las rutas de direcciones; en una ventana, si el docente
 *   tildó "Guardar esta dirección" = body.saveAddress).
 * @returns {{value: object}|{message: string, fields: object}} `value` con los
 *   mismos campos en camelCase (label null si no se guarda), o el primer problema.
 * Lo usan: routes/teachers/index.js y lib/availabilityWindow.js (validateWindow).
 */
export function validateAddress(body, { saving }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { message: 'La dirección tiene un formato inválido.', fields: {} };
  }

  const value = {};
  const label = text(body.label);
  if (saving) {
    if (!label) {
      return {
        message: 'Ponele un nombre a la dirección (Casa, Escuela...).',
        fields: { label: 'required' },
      };
    }
    if (label.length > MAX_LABEL_LENGTH) {
      return {
        message: `El nombre puede tener hasta ${MAX_LABEL_LENGTH} caracteres.`,
        fields: { label: 'invalid' },
      };
    }
  }
  value.label = label || null;

  for (const field of FIELDS) {
    const raw = text(body[field.key]);
    if (!raw && field.required) {
      return { message: `Falta ${field.label}.`, fields: { [field.key]: 'required' } };
    }
    if (raw.length > field.max) {
      return {
        message: `${capitalize(field.label)} puede tener hasta ${field.max} caracteres.`,
        fields: { [field.key]: 'invalid' },
      };
    }
    value[field.key] = raw || null;
  }
  return { value };
}

function capitalize(phrase) {
  // "la calle" -> "La calle"
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * La dirección completa en una línea, para la clase y para mostrar:
 * "Av. Corrientes 1234, piso 3, depto. B · CP 1043 · Balvanera, CABA · Timbre 3B".
 * Se copia a la clase al reservar: después no cambia aunque el docente la edite.
 *
 * @param {object} address - { street, number, postalCode, locality, city, floor?,
 *   apartment?, notes? } en camelCase; al reservar es `window.address`, que viene
 *   de teacher_addresses vía la consulta de la ventana en db/availability.js.
 * @returns {string} la línea que se guarda en classes.address.
 * Lo usa: db/bookings.js (insertBooking, al crear la clase).
 * Espejo: frontend/src/utils/addresses.js (formatAddress).
 */
export function formatAddress(address) {
  const calle = [`${address.street} ${address.number}`];
  if (address.floor) calle.push(`piso ${address.floor}`);
  if (address.apartment) calle.push(`depto. ${address.apartment}`);
  const partes = [
    calle.join(', '),
    `CP ${address.postalCode}`,
    `${address.locality}, ${address.city}`,
  ];
  if (address.notes) partes.push(address.notes);
  return partes.join(' · ');
}

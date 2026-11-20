// Las direcciones presenciales del docente (tabla teacher_addresses): pasar
// entre la forma de la API y la del formulario, validar y armar la línea
// para mostrar.
//
// Espejo: backend/src/lib/addresses.js (topes de largo, campos obligatorios y
// formatAddress). Acá sirve solo para marcar los campos antes de mandar: el
// backend vuelve a chequear todo. Si se toca allá, va acá.
//
// `locality` es lo que ve cualquier alumno antes de pagar; el resto es la
// dirección exacta.
//
// Lo usan: components/AddressFields.jsx, pages/Profile/AddressDialog.jsx,
// pages/Profile/AddressesSection.jsx, pages/Availability/WindowForm.jsx y
// WindowCard.jsx, y utils/windows.js (la dirección dentro del borrador de ventana).

export const MAX_LABEL_LENGTH = 40

// En el orden del formulario. `max` = los mismos topes que la base.
export const ADDRESS_FIELDS = [
  { key: 'street', label: 'Calle', max: 120, required: true, placeholder: 'Av. Corrientes' },
  { key: 'number', label: 'Número', max: 10, required: true, placeholder: '1234' },
  { key: 'postalCode', label: 'Código postal', max: 10, required: true, placeholder: '1043' },
  { key: 'locality', label: 'Localidad', max: 100, required: true, placeholder: 'Balvanera' },
  { key: 'city', label: 'Ciudad', max: 100, required: true, placeholder: 'CABA' },
  { key: 'floor', label: 'Piso', max: 10, required: false, placeholder: '3' },
  { key: 'apartment', label: 'Departamento', max: 10, required: false, placeholder: 'B' },
  {
    key: 'notes',
    label: 'Detalle adicional',
    max: 200,
    required: false,
    placeholder: 'Timbre 3B, entrada por el costado...',
  },
]

export const EMPTY_ADDRESS = {
  label: '',
  street: '',
  number: '',
  postalCode: '',
  locality: '',
  city: '',
  floor: '',
  apartment: '',
  notes: '',
}

/**
 * Una dirección de la API como valores del formulario (los null pasan a '').
 *
 * @param {object|null} address - una dirección como la devuelve
 *   GET /api/teachers/me/addresses, o el `address` de una ventana.
 * @returns {object} los campos de EMPTY_ADDRESS, todos string.
 * Lo usan: pages/Profile/AddressDialog.jsx, utils/windows.js (draftFromWindow).
 */
export function addressToForm(address) {
  const form = { ...EMPTY_ADDRESS }
  for (const key of Object.keys(EMPTY_ADDRESS)) form[key] = address?.[key] ?? ''
  return form
}

/**
 * Lo que va al backend: sin espacios de más. Los opcionales vacíos los pasa a null el backend.
 *
 * @param {object} form - los valores del formulario (ver addressToForm).
 * @returns {object} { label, street, number, postalCode, locality, city, floor, apartment, notes }
 *   recortados, para POST/PUT /api/teachers/me/addresses o el `address` de una ventana.
 * Lo usan: pages/Profile/AddressDialog.jsx, utils/windows.js (draftToPayload).
 */
export function addressToPayload(form) {
  const payload = {}
  for (const key of Object.keys(EMPTY_ADDRESS)) payload[key] = String(form[key] ?? '').trim()
  return payload
}

/**
 * { campo: mensaje } con lo que falta o sobra. El nombre ("Casa") solo es
 * obligatorio si se guarda: una dirección de una sola ventana no lo necesita.
 *
 * @param {object} form - los valores del formulario.
 * @param {{saving: boolean}} options - saving: true si va a quedar guardada
 *   (perfil, o "Guardar esta dirección" en el formulario de ventana).
 * @returns {object} { campo: mensaje }; vacío si está todo bien.
 * Lo usan: pages/Profile/AddressDialog.jsx, utils/windows.js (validateDraft).
 * Espejo: backend/src/lib/addresses.js.
 */
export function addressErrors(form, { saving }) {
  const errors = {}
  const label = String(form.label ?? '').trim()
  if (saving && !label) errors.label = 'Ponele un nombre: Casa, Escuela, Oficina...'
  else if (label.length > MAX_LABEL_LENGTH) errors.label = `Hasta ${MAX_LABEL_LENGTH} caracteres.`

  for (const field of ADDRESS_FIELDS) {
    const value = String(form[field.key] ?? '').trim()
    if (field.required && !value) errors[field.key] = 'Completalo.'
    else if (value.length > field.max) errors[field.key] = `Hasta ${field.max} caracteres.`
  }
  return errors
}

/**
 * La dirección completa en una línea, igual que la arma el backend para la
 * clase: "Av. Corrientes 1234, piso 3, depto. B · CP 1043 · Balvanera, CABA · Timbre 3B".
 *
 * @param {object|null} address - una dirección de la API (perfil o `address` de una ventana).
 * @returns {string} la línea, o '' si no hay dirección.
 * Lo usan: pages/Profile/AddressesSection.jsx, pages/Availability/WindowForm.jsx y WindowCard.jsx.
 * Espejo: formatAddress de backend/src/lib/addresses.js (el que llena classes.address).
 */
export function formatAddress(address) {
  if (!address) return ''
  const calle = [`${address.street} ${address.number}`]
  if (address.floor) calle.push(`piso ${address.floor}`)
  if (address.apartment) calle.push(`depto. ${address.apartment}`)
  const partes = [
    calle.join(', '),
    `CP ${address.postalCode}`,
    `${address.locality}, ${address.city}`,
  ]
  if (address.notes) partes.push(address.notes)
  return partes.join(' · ')
}

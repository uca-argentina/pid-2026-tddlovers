// Las direcciones del docente. La validación es un ESPEJO de
// backend/src/lib/addresses.js y sirve solo para marcar los campos antes de
// mandar: el backend vuelve a chequear todo. Si se toca allá, va acá.
//
// `locality` es lo que ve cualquier alumno antes de pagar; el resto es la
// dirección exacta.

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

/** Una dirección de la API como valores del formulario (los null pasan a ''). */
export function addressToForm(address) {
  const form = { ...EMPTY_ADDRESS }
  for (const key of Object.keys(EMPTY_ADDRESS)) form[key] = address?.[key] ?? ''
  return form
}

/** Lo que va al backend: sin espacios de más. Los opcionales vacíos los pasa a null el backend. */
export function addressToPayload(form) {
  const payload = {}
  for (const key of Object.keys(EMPTY_ADDRESS)) payload[key] = String(form[key] ?? '').trim()
  return payload
}

/**
 * { campo: mensaje } con lo que falta o sobra. El nombre ("Casa") solo es
 * obligatorio si se guarda: una dirección de una sola ventana no lo necesita.
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

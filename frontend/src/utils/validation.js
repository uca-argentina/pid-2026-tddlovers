// Funciones puras de validación, compartidas por los distintos pasos del
// formulario. No dependen de React, así que no tiene sentido modelarlas
// como clases — son las mismas reglas que valida (de nuevo) el backend.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+\d][\d\s\-()]{5,20}$/

export function isValidEmail(email) {
  return EMAIL_RE.test(email.trim())
}

export function isValidPhone(phone) {
  if (!phone) return true // opcional
  return PHONE_RE.test(phone.trim())
}

export function passwordRules(password) {
  return {
    minLength: password.length >= 10,
    hasLower: /[a-z]/.test(password),
    hasUpper: /[A-Z]/.test(password),
    hasNumber: /\d/.test(password),
    // Igual que el backend: cualquier cosa que no sea letra, dígito o
    // espacio cuenta como carácter especial.
    hasSpecial: /[^A-Za-z0-9\s]/.test(password),
  }
}

export function isValidPassword(password) {
  const rules = passwordRules(password)
  return (
    rules.minLength &&
    rules.hasLower &&
    rules.hasUpper &&
    rules.hasNumber &&
    rules.hasSpecial
  )
}

export function isNonEmptyName(value) {
  return value.trim().length > 0 && value.trim().length <= 100
}

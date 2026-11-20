// Funciones puras de validación, compartidas por los distintos pasos del
// formulario. No dependen de React, así que no tiene sentido modelarlas
// como clases. El backend vuelve a validar lo mismo, salvo el tope de 100
// caracteres de nombre y apellido (isNonEmptyName), que solo pone la UI.
//
// Espejo: EMAIL_RE de backend/src/routes/auth/index.js, PHONE_RE de
// backend/src/routes/users/index.js y las reglas de contraseña de
// backend/src/lib/password.js.
// Lo usan: pages/Register/steps/StepAccount.jsx, pages/Login/LoginPage.jsx y
// pages/Profile/ProfilePage.jsx (teléfono).

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^[+\d][\d\s\-()]{5,20}$/

/** Si el email tiene forma de email (algo@algo.algo). Lo usan: StepAccount.jsx, LoginPage.jsx. */
export function isValidEmail(email) {
  return EMAIL_RE.test(email.trim())
}

/** Si el teléfono es válido; vacío vale porque es opcional. Lo usan: StepAccount.jsx, ProfilePage.jsx. */
export function isValidPhone(phone) {
  if (!phone) return true // opcional
  return PHONE_RE.test(phone.trim())
}

function passwordRules(password) {
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

/**
 * Si la contraseña cumple todo: 10+ caracteres, minúscula, mayúscula, número y especial.
 * Lo usa: pages/Register/steps/StepAccount.jsx.
 */
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

/** Nombre o apellido no vacío y de hasta 100 caracteres. Lo usa: pages/Register/steps/StepAccount.jsx. */
export function isNonEmptyName(value) {
  return value.trim().length > 0 && value.trim().length <= 100
}

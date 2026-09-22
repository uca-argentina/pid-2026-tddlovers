// Manejo del tema claro/oscuro. El tema vive en el atributo data-theme de
// <html> (ver las tres variantes de paleta en index.css) y se recuerda en
// localStorage para que no se pierda al refrescar.
//
// Es el único lugar de la app que toca el almacenamiento del navegador, y
// todo va dentro de try/catch porque en modo privado leer o escribir puede
// tirar excepción.

const STORAGE_KEY = 'pid-theme'

export const THEME_LIGHT = 'light'
export const THEME_DARK = 'dark'

export function readStoredTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === THEME_DARK || value === THEME_LIGHT ? value : null
  } catch {
    return null
  }
}

export function storeTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // modo privado: el tema igual funciona, solo que no se recuerda
  }
}

/** Lo que pide el sistema operativo, si el navegador sabe contestarlo. */
export function prefersDark() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

/** Lo que el usuario eligió la última vez; si nunca eligió, lo del sistema. */
export function resolveInitialTheme() {
  return readStoredTheme() || (prefersDark() ? THEME_DARK : THEME_LIGHT)
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme
}

/**
 * Las iniciales del usuario para el avatar. Vive acá y no adentro de una
 * pantalla porque lo usan dos que no se importan entre sí: el perfil y la
 * barra lateral.
 *
 * Tolera que falte el usuario (todavía no contestó /me, o no hay sesión):
 * devuelve lo que haya, o '' si no hay nada. Quien la llama decide qué
 * mostrar cuando viene vacía.
 *
 * @param {object|null} user - el usuario de la sesión ({ nombre, apellido }), de /api/auth/me.
 * @returns {string} p. ej. 'AG'.
 * Lo usan: components/NavBar.jsx, pages/Profile/ProfilePage.jsx.
 */
export function getInitials(user) {
  const nombre = user?.nombre
  const apellido = user?.apellido
  return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase()
}

/**
 * El rol desde el que se mira la app, a partir del usuario: 'teacher',
 * 'admin' o, si no (alumno o sin sesión), 'student'.
 *
 * @param {object|null} user - el usuario de la sesión (su `role`).
 * @returns {'teacher'|'admin'|'student'}
 * Lo usan: App.jsx (viewRole, qué rutas montar), pages/Profile/ProfilePage.jsx.
 */
export function roleOf(user) {
  if (user?.role === 'admin' || user?.role === 'teacher') return user.role
  return 'student'
}

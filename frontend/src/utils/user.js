/**
 * Las iniciales del usuario para el avatar. Vive acá y no adentro de una
 * pantalla porque lo usan dos que no se importan entre sí: el perfil y la
 * barra lateral.
 *
 * Tolera que falte el usuario o el apellido (el registro no lo exige en
 * todos los casos): devuelve lo que haya, o '' si no hay nada. Quien la
 * llama decide qué mostrar cuando viene vacía.
 */
export function getInitials(user) {
  const nombre = user?.nombre
  const apellido = user?.apellido
  return `${nombre?.charAt(0) || ''}${apellido?.charAt(0) || ''}`.toUpperCase()
}

/**
 * El rol desde el que se mira la app, a partir del usuario: 'teacher',
 * 'admin' o, si no (alumno o sin sesión), 'student'.
 */
export function roleOf(user) {
  if (user?.role === 'admin' || user?.role === 'teacher') return user.role
  return 'student'
}

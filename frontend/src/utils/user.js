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

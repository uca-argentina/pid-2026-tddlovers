// Los docentes favoritos del alumno, del lado del front. El tablero, el
// calendario y "Mis reservas" guardan solo los ids (como string: un id puede
// venir de la URL o del backend y se comparan con ===).

/** Los ids de lo que devuelve GET /api/favorites. */
export function favoriteIdsOf(teachers) {
  return (Array.isArray(teachers) ? teachers : []).map((teacher) => String(teacher.id))
}

/** La lista con ese docente agregado (favorite = true) o sacado, sin repetirlo. */
export function withFavorite(ids, teacherId, favorite) {
  const id = String(teacherId)
  const sinEl = (ids || []).filter((item) => item !== id)
  return favorite ? [...sinEl, id] : sinEl
}

/** ¿Es favorito? false si la lista es null (no se cargó o no es alumno). */
export function isFavorite(ids, teacherId) {
  return Boolean(ids) && ids.includes(String(teacherId))
}

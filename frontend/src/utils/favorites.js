// Los docentes favoritos del alumno, del lado del front. El tablero, el
// calendario y "Mis reservas" guardan solo los ids (como string: un id puede
// venir de la URL o del backend y se comparan con ===).
//
// Lo usan: routes/withFavorites.jsx (arma y actualiza la lista) y, para
// pintar el corazón, components/ClassCard.jsx, pages/Calendar/DayAgenda.jsx y
// pages/Booking/BookingResults.jsx.

/**
 * Los ids de lo que devuelve GET /api/favorites.
 *
 * @param {Array<{id: string}>} teachers - la respuesta de fetchFavoriteTeachers().
 * @returns {string[]} los ids como string (vacío si no llegó un array).
 * Lo usa: routes/withFavorites.jsx.
 */
export function favoriteIdsOf(teachers) {
  return (Array.isArray(teachers) ? teachers : []).map((teacher) => String(teacher.id))
}

/**
 * La lista con ese docente agregado (favorite = true) o sacado, sin repetirlo.
 *
 * @param {string[]|null} ids - la lista actual (estado de withFavorites).
 * @param {string} teacherId - el docente cuyo corazón se tocó (lo informa FavoriteButton).
 * @param {boolean} favorite - cómo quedó.
 * @returns {string[]} una lista nueva.
 * Lo usa: routes/withFavorites.jsx.
 */
export function withFavorite(ids, teacherId, favorite) {
  const id = String(teacherId)
  const sinEl = (ids || []).filter((item) => item !== id)
  return favorite ? [...sinEl, id] : sinEl
}

/**
 * ¿Es favorito? false si la lista es null (no se cargó o no es alumno).
 * `ids` es la prop `favoriteIds` que inyecta withFavorites.
 * Lo usan: components/ClassCard.jsx, pages/Calendar/DayAgenda.jsx, pages/Booking/BookingResults.jsx.
 */
export function isFavorite(ids, teacherId) {
  return Boolean(ids) && ids.includes(String(teacherId))
}

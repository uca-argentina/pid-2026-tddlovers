import { Component } from 'react'
import { fetchFavoriteTeachers } from '../api/client.js'
import { favoriteIdsOf, withFavorite } from '../utils/favorites.js'

// Por defecto el rol sale de `viewRole`, que es lo que App les pasa a las
// pantallas. Quien no lo recibe (el tablero de reservar recibe `user`) pasa
// su propia regla.
const byViewRole = (props) => props.viewRole === 'student'

/**
 * Le baja a una pantalla los docentes favoritos del alumno, con una sola
 * regla para todas (antes cada pantalla tenía su copia y ya decían cosas
 * distintas):
 *
 * - `favoriteIds`: ids (string) de sus favoritos, o null si no es alumno o si
 *   el pedido falló. null = no se muestran corazones: uno vacío para un
 *   docente que ya es favorito mentiría, y marcarlo de nuevo no cambiaría
 *   nada visible.
 * - `favoriteError`: el último error de FavoriteButton, o null. Se limpia
 *   cuando un corazón vuelve a guardar bien.
 * - `onFavoriteChange(teacherId, favorite)` y `onFavoriteError(message)`: lo
 *   que espera FavoriteButton, para pasárselo tal cual.
 *
 * Se vuelve a pedir si cambia el rol (la sesión llegó después del montaje).
 * Es un HOC de clase, como withViewport: los hooks viven solo en
 * withRouter.jsx.
 *
 * Origen: los favoritos salen de GET /api/favorites (fetchFavoriteTeachers,
 * backend/src/routes/favorites/index.js), pasados a ids con favoriteIdsOf;
 * los cambios llegan de FavoriteButton por onFavoriteChange y se aplican con
 * withFavorite (utils/favorites.js), sin volver a pedir la lista.
 *
 * @param {Component} Wrapped - la pantalla a envolver.
 * @param {{isStudent?: (props) => boolean}} [options] - cómo saber si es alumno
 *   a partir de las props; por defecto `props.viewRole === 'student'`.
 * @returns {Component} el componente envuelto, con todas sus props más las cuatro de arriba.
 * Lo usan: pages/Calendar/CalendarPage.jsx y pages/Reservations/ReservationsPage.jsx
 * (con viewRole), y pages/Booking/BookingBoard.jsx (con
 * `isStudent: props.user?.role === 'student'`, porque recibe `user` y no viewRole).
 */
export default function withFavorites(Wrapped, { isStudent = byViewRole } = {}) {
  class WithFavorites extends Component {
    state = { favoriteIds: null, favoriteError: null }

    // Descarta respuestas viejas (cambio de rol en el medio, o el doble
    // montaje de <StrictMode>): un token y no un flag de desmontado.
    token = 0

    componentDidMount() {
      this.load()
    }

    componentDidUpdate(prevProps) {
      if (isStudent(prevProps) !== isStudent(this.props)) this.load()
    }

    componentWillUnmount() {
      this.token += 1
    }

    // Pide los favoritos si es alumno; si no, deja todo en null sin pedir nada.
    load() {
      const token = ++this.token
      if (!isStudent(this.props)) {
        this.setState({ favoriteIds: null, favoriteError: null })
        return
      }
      fetchFavoriteTeachers()
        .then((teachers) => {
          if (token === this.token) this.setState({ favoriteIds: favoriteIdsOf(teachers) })
        })
        .catch(() => {
          if (token === this.token) this.setState({ favoriteIds: null })
        })
    }

    handleFavoriteChange = (teacherId, favorite) => {
      this.setState((prev) => ({
        favoriteIds: withFavorite(prev.favoriteIds, teacherId, favorite),
        favoriteError: null,
      }))
    }

    handleFavoriteError = (message) => {
      this.setState({ favoriteError: message })
    }

    render() {
      return (
        <Wrapped
          {...this.props}
          favoriteIds={this.state.favoriteIds}
          favoriteError={this.state.favoriteError}
          onFavoriteChange={this.handleFavoriteChange}
          onFavoriteError={this.handleFavoriteError}
        />
      )
    }
  }

  WithFavorites.displayName = `withFavorites(${Wrapped.displayName || Wrapped.name || 'Component'})`

  return WithFavorites
}

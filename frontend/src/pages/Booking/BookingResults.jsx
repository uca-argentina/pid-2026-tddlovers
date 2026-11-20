import { Component } from 'react'
import BookingCard from './BookingCard.jsx'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { formatDayLong } from '../../utils/calendar.js'
import { isFavorite } from '../../utils/favorites.js'
import { countBookableByDate } from '../../utils/booking.js'
import { usablePackFor } from '../../utils/packs.js'
import './BookingResults.css'

/**
 * El panel del día elegido: las clases que se pueden reservar ese día, ya
 * filtradas. Es el equivalente de DayAgenda pero del otro lado — ahí se ven
 * las clases propias, acá las que todavía no son de nadie.
 *
 * Sin fetch propio: los datos bajan por props.
 *
 * Props (de BookingBoard.renderResults):
 *   - date: el día elegido (Date, de state.selectedIso).
 *   - cards: tarjetas de ese día ya filtradas (getFilteredByDate).
 *   - loading / filtered: si se está cargando el rango y si hay filtros activos.
 *   - packs: paquetes del alumno (GET /api/packs/mine, ya ajustados si se
 *     reprograma); cada BookingCard muestra el que se puede usar con ESE
 *     docente ESE día (usablePackFor), el mismo que ofrece el modal.
 *   - favoriteIds, favoriteError, onFavoriteChange, onFavoriteError: los de
 *     withFavorites, reenviados por BookingBoard.
 *   - onReservar(card) → handler: abre BookingDialog con esa tarjeta.
 */
class BookingResults extends Component {
  renderEmpty() {
    // Distinguir las dos causas importa: si el día no tiene nada, tocar los
    // filtros no va a servir de nada, y al revés.
    if (this.props.filtered) {
      return (
        <p className="booking-results-empty">
          Ningún horario libre de ese día coincide con los filtros.
        </p>
      )
    }
    return <p className="booking-results-empty">No hay horarios libres ese día.</p>
  }

  render() {
    const { date, cards, loading } = this.props
    // FILTRO: las de licencia se muestran (en gris) pero no cuentan como para
    // reservar; mismo criterio que el número verde del calendario.
    const reservables = countBookableByDate({ dia: cards }).dia || 0

    return (
      <section className="booking-results">
        <h2 className="booking-results-title">{formatDayLong(date)}</h2>
        <p className="booking-results-count">
          {reservables} {reservables === 1 ? 'clase para reservar' : 'clases para reservar'}
        </p>

        {this.props.favoriteError ? (
          <Banner type="danger">{this.props.favoriteError}</Banner>
        ) : null}

        {loading ? (
          <p className="booking-results-empty">
            <SpinnerIcon className="spin" />
            Buscando horarios...
          </p>
        ) : null}
        {!loading && cards.length === 0 ? this.renderEmpty() : null}
        {!loading && cards.length > 0 ? (
          <ul className="booking-results-list">
            {cards.map((card) => (
              <BookingCard
                key={card.id}
                card={card}
                pack={usablePackFor(this.props.packs, card.teacherId, card.date)}
                favorite={isFavorite(this.props.favoriteIds, card.teacherId)}
                showFavorite={Boolean(this.props.favoriteIds)}
                onReservar={this.props.onReservar(card)}
                onFavoriteChange={this.props.onFavoriteChange}
                onFavoriteError={this.props.onFavoriteError}
              />
            ))}
          </ul>
        ) : null}
      </section>
    )
  }
}

BookingResults.defaultProps = {
  cards: [],
  loading: false,
  filtered: false,
  packs: [],
  // null = no hay corazones (no es alumno); un array = los ids favoritos.
  favoriteIds: null,
  favoriteError: null,
  onFavoriteChange: () => {},
  onFavoriteError: () => {},
  // Curried como todos los handlers por ítem de la app: onReservar(card)
  // devuelve el handler del botón de esa tarjeta.
  onReservar: () => () => {},
}

export default BookingResults

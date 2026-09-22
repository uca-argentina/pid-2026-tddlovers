import { Component } from 'react'
import BookingCard from './BookingCard.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { formatDayLong } from '../../utils/calendar.js'
import './BookingResults.css'

/**
 * El panel del día elegido: las clases que se pueden reservar ese día, ya
 * filtradas. Es el equivalente de DayAgenda pero del otro lado — ahí se ven
 * las clases propias, acá las que todavía no son de nadie.
 *
 * Sin fetch propio: los datos bajan por props.
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

    return (
      <section className="booking-results">
        <h2 className="booking-results-title">{formatDayLong(date)}</h2>
        <p className="booking-results-count">
          {cards.length} {cards.length === 1 ? 'clase para reservar' : 'clases para reservar'}
        </p>

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
              <BookingCard key={card.id} card={card} onReservar={this.props.onReservar(card)} />
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
  // Curried como todos los handlers por ítem de la app: onReservar(card)
  // devuelve el handler del botón de esa tarjeta.
  onReservar: () => () => {},
}

export default BookingResults

import { Component } from 'react'
import { formatRangeLabel, formatSlotTotal } from '../../utils/availability.js'
import { formatClashes } from '../../utils/booking.js'

/**
 * Una tarjeta = un docente, una materia y un día. Muestra todos los tramos
 * libres de ese día juntos (13:00 – 15:30 · 16:00 – 17:00 es UNA tarjeta) y,
 * si el alumno ya tiene algo que se pisa, lo avisa en gris.
 *
 * Una superposición parcial NO impide reservar: solo choca un pedazo, y el
 * modal deja elegir la hora adentro de lo que queda. Recién cuando no queda ni
 * una hora entera la tarjeta se apaga y el botón va deshabilitado.
 *
 * Los estilos están en BookingResults.css: fuera de la lista no significan
 * nada (misma excepción que DayCell con MonthGrid.css).
 */
class BookingCard extends Component {
  render() {
    const { card } = this.props
    const aviso = formatClashes(card.clashes, card.bookable)

    return (
      <li className={`booking-card ${card.bookable ? '' : 'is-blocked'}`}>
        <div className="booking-card-head">
          <span className="booking-card-subject">{card.subjectName}</span>
          <span className="booking-card-teacher">{card.teacherName}</span>
        </div>

        <p className="booking-card-ranges">
          {card.ranges.map((range) => formatRangeLabel(range.start, range.end)).join(' · ')}
        </p>
        <p className="booking-card-total">{formatSlotTotal(card.totalSlots)} libres</p>

        {aviso ? <p className="booking-card-clash">{aviso}</p> : null}

        <div className="booking-card-actions">
          <button
            type="button"
            className="btn btn-primary"
            disabled={!card.bookable}
            onClick={this.props.onReservar}
            // Los botones de todas las tarjetas dicen lo mismo: sin esto, leído
            // con un lector de pantalla no se sabe cuál es cuál.
            aria-label={`Reservar ${card.subjectName} con ${card.teacherName}`}
          >
            Reservar
          </button>
        </div>
      </li>
    )
  }
}

export default BookingCard

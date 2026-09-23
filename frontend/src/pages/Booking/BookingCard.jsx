import { Component } from 'react'
import { ClockIcon, PinIcon, UsersIcon, VideoIcon } from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatClashes, formatEnrolled, formatSlotCount } from '../../utils/booking.js'
import {
  capacityLabel,
  formatMinutes,
  formatPrice,
  modalityLabel,
  needsAddress,
} from '../../utils/windows.js'

/**
 * Una tarjeta = una clase que ofrece un docente un día: la materia manda
 * (es lo que el alumno busca), y abajo con quién, a qué hora, cuánto dura
 * cada clase, dónde es y si es individual o grupal.
 *
 * Si es grupal y alguien ya arrancó un turno con lugar, se dice: sumarse a
 * una clase que ya existe es distinto de abrir una nueva, y es justo lo que
 * vuelve útil una grupal.
 *
 * Una superposición con clases propias NO apaga la tarjeta mientras quede
 * algún turno libre: el modal deja elegir entre lo que queda. Recién sin
 * ninguno el botón va deshabilitado.
 *
 * Los estilos están en BookingResults.css: fuera de la lista no significan
 * nada (misma excepción que DayCell con MonthGrid.css).
 */
class BookingCard extends Component {
  getGroupsWithRoom() {
    return this.props.card.slots.filter((slot) => slot.enrolled > 0 && !slot.joined)
  }

  renderLocation() {
    const { card } = this.props
    const Icono = card.modality === 'in_person' ? PinIcon : VideoIcon
    const donde = needsAddress(card.modality) && card.address ? ` · ${card.address}` : ''

    return (
      <li>
        <Icono />
        <span className="booking-card-ellipsis">
          {modalityLabel(card.modality)}
          {donde}
        </span>
      </li>
    )
  }

  renderGroups() {
    const { card } = this.props
    const grupos = this.getGroupsWithRoom()
    if (grupos.length === 0) return null

    const primero = grupos[0]
    const texto =
      grupos.length === 1
        ? `Sumate a la de las ${primero.start}: ${formatEnrolled(primero.enrolled, card.maxStudents)}.`
        : `${grupos.length} clases grupales con lugar para sumarte.`

    return <p className="booking-card-groups">{texto}</p>
  }

  render() {
    const { card } = this.props
    const aviso = formatClashes(card.clashes, card.bookable)
    const libres = card.slots.filter((slot) => !slot.blocked).length

    return (
      <li className={`booking-card ${card.bookable ? '' : 'is-blocked'}`}>
        <div className="booking-card-head">
          <span className="booking-card-subject">{card.subject.name}</span>
          <span className={`booking-card-kind ${card.maxStudents > 1 ? 'is-group' : ''}`}>
            <UsersIcon />
            {capacityLabel(card.maxStudents)}
          </span>
        </div>
        <p className="booking-card-teacher">con {card.teacherName}</p>

        <ul className="booking-card-facts">
          <li>
            <ClockIcon />
            <span>
              <span className="booking-card-ranges">{formatRangeLabel(card.start, card.end)}</span>
              {' · '}clases de {formatMinutes(card.durationMinutes)}
            </span>
          </li>
          {this.renderLocation()}
        </ul>

        {this.renderGroups()}

        {card.joined.length > 0 ? (
          <p className="booking-card-joined">
            Ya estás anotado a las {card.joined.map((slot) => slot.start).join(' y ')}.
          </p>
        ) : null}
        {aviso ? <p className="booking-card-clash">{aviso}</p> : null}

        <div className="booking-card-actions">
          <span className="booking-card-price">
            {formatPrice(card.price)}
            <span className="booking-card-total"> · {formatSlotCount(libres)}</span>
          </span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!card.bookable}
            onClick={this.props.onReservar}
            // Los botones de todas las tarjetas dicen lo mismo: sin esto, leído
            // con un lector de pantalla no se sabe cuál es cuál.
            aria-label={`Reservar ${card.subject.name} con ${card.teacherName}`}
          >
            Reservar
          </button>
        </div>
      </li>
    )
  }
}

export default BookingCard

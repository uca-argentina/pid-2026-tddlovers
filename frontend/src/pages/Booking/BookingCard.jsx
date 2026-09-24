import { Component } from 'react'
import { ClockIcon, PinIcon, UsersIcon, VideoIcon } from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatClashes, formatEnrolled, lowestRate } from '../../utils/booking.js'
import { formatHourlyRate } from '../../utils/rates.js'
import { capacityLabel, modalityLabel, needsAddress } from '../../utils/windows.js'

/**
 * Una tarjeta = un horario que ofrece un docente un día: arriba las materias
 * que se pueden reservar ahí (es lo que el alumno busca), y abajo con quién,
 * en qué rango, dónde es, si es individual o grupal y desde cuánto la hora.
 * La materia y la duración se eligen en el modal.
 *
 * Si es grupal y alguien ya arrancó una clase con lugar, se dice: sumarse a
 * una clase que ya existe es distinto de abrir una nueva, y es justo lo que
 * vuelve útil una grupal.
 *
 * Una superposición con clases propias NO apaga la tarjeta mientras quede
 * algún horario libre: el modal deja elegir entre lo que queda. Recién sin
 * ninguno el botón va deshabilitado.
 *
 * Los estilos están en BookingResults.css: fuera de la lista no significan
 * nada (misma excepción que DayCell con MonthGrid.css).
 */
class BookingCard extends Component {
  getGroupsWithRoom() {
    return this.props.card.groups.filter((group) => !group.joined)
  }

  /**
   * '$ 5.000/h' si todas las materias cuestan lo mismo; si no, 'Desde
   * $ 5.000/h': el precio exacto depende de la materia y la duración.
   */
  renderRate() {
    const { card } = this.props
    const minima = lowestRate(card)
    if (minima === null) return null
    const todasIguales = card.subjects.every((subject) => subject.hourlyRateCents === minima)
    if (todasIguales) return formatHourlyRate(minima)
    return minima === 0 ? 'Algunas materias sin cargo' : `Desde ${formatHourlyRate(minima)}`
  }

  renderLocation() {
    const { card } = this.props
    const Icono = card.modality === 'in_person' ? PinIcon : VideoIcon
    // La localidad y no la dirección: la exacta se la lleva recién el que reserva.
    const donde = needsAddress(card.modality) && card.locality ? ` · ${card.locality}` : ''

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
        ? `Sumate a ${primero.subjectName} de las ${primero.start}: ${formatEnrolled(primero.enrolled, card.maxStudents)}.`
        : `${grupos.length} clases grupales con lugar para sumarte.`

    return <p className="booking-card-groups">{texto}</p>
  }

  render() {
    const { card } = this.props
    const aviso = formatClashes(card.clashes, card.bookable)
    const materias = card.subjects.map((subject) => subject.name).join(' · ')

    return (
      <li className={`booking-card ${card.bookable ? '' : 'is-blocked'}`}>
        <div className="booking-card-head">
          <span className="booking-card-subject">{materias}</span>
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
              {' · '}vos elegís cuánto dura
            </span>
          </li>
          {this.renderLocation()}
        </ul>

        {this.renderGroups()}

        {card.joined.length > 0 ? (
          <p className="booking-card-joined">
            Ya estás anotado a las {card.joined.map((group) => group.start).join(' y ')}.
          </p>
        ) : null}
        {aviso ? <p className="booking-card-clash">{aviso}</p> : null}

        <div className="booking-card-actions">
          <span className="booking-card-price">{this.renderRate()}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!card.bookable}
            onClick={this.props.onReservar}
            // Los botones de todas las tarjetas dicen lo mismo: sin esto, leído
            // con un lector de pantalla no se sabe cuál es cuál.
            aria-label={`Reservar con ${card.teacherName}, ${formatRangeLabel(card.start, card.end)}`}
          >
            Reservar
          </button>
        </div>
      </li>
    )
  }
}

export default BookingCard

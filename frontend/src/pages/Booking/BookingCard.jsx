import { Component } from 'react'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { ClockIcon, PinIcon, UsersIcon, VideoIcon } from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatEnrolled, lowestRate } from '../../utils/booking.js'
import { formatHourlyRate } from '../../utils/rates.js'
import { packClassesLabel } from '../../utils/packs.js'
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
 * Qué inicios y qué grupales trae la tarjeta lo decidió el backend para este
 * alumno (sin lo completo, sin lo que le choca, sin las grupales en las que
 * ya está): si la tarjeta llegó, tiene algo para reservar. La única que llega
 * sin nada es la de licencia, que se muestra en gris.
 *
 * Los estilos están en BookingResults.css: fuera de la lista no significan
 * nada (misma excepción que DayCell con MonthGrid.css).
 *
 * Props (de BookingResults):
 *   - card: una fila de GET /api/availability.
 *   - pack: el paquete del alumno que sirve con ese docente ese día (usablePackFor), o null.
 *   - favorite / showFavorite: si el docente es favorito y si mostrar el corazón.
 *   - onFavoriteChange, onFavoriteError: para FavoriteButton (de withFavorites).
 *   - onReservar: onClick del botón "Reservar" (abre BookingDialog).
 */
class BookingCard extends Component {
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

  /**
   * FILTRO: el resumen del paquete solo si hay uno que sirve con este docente
   * ESTE día (usablePackFor: `usable` del backend + que no venza antes). Se
   * cuentan las disponibles (no las que quedan) para no prometer clases que
   * ya están apartadas por otras reservas.
   */
  renderPack() {
    const { pack } = this.props
    if (!pack) return null
    const quedan = pack.available === 1 ? 'Te queda' : 'Te quedan'
    return (
      <p className="booking-card-pack">
        {quedan} {packClassesLabel(pack.available, pack.classMinutes)} del paquete.
      </p>
    )
  }

  renderTags() {
    const { card } = this.props
    // De licencia el backend ya manda teacherFeatured en false.
    const destacada = card.teacherFeatured
    if (!destacada && !card.teacherAcceptsRewards) return null
    return (
      <div className="booking-card-tags">
        {destacada ? <span className="booking-card-tag is-featured">Destacado</span> : null}
        {card.teacherAcceptsRewards ? (
          <span className="booking-card-tag">Acepta neuronas</span>
        ) : null}
      </div>
    )
  }

  renderGroups() {
    const { card } = this.props
    // Son solo las grupales a las que este alumno se puede sumar (backend).
    const grupos = card.groups
    if (grupos.length === 0) return null

    const primero = grupos[0]
    const texto =
      grupos.length === 1
        ? `Sumate a ${primero.subjectName} de las ${primero.start}: ${formatEnrolled(primero.enrolled, primero.maxStudents)}.`
        : `${grupos.length} clases grupales con lugar para sumarte.`

    return <p className="booking-card-groups">{texto}</p>
  }

  render() {
    const { card } = this.props
    const materias = card.subjects.map((subject) => subject.name).join(' · ')

    return (
      <li
        className={`booking-card ${card.onVacation ? 'is-blocked is-vacation' : ''}`}
      >
        <div className="booking-card-head">
          <span className="booking-card-subject">{materias}</span>
          <span className={`booking-card-kind ${card.maxStudents > 1 ? 'is-group' : ''}`}>
            <UsersIcon />
            {capacityLabel(card.maxStudents)}
          </span>
        </div>
        <div className="booking-card-teacher-row">
          <p className="booking-card-teacher">con {card.teacherName}</p>
          {this.props.showFavorite ? (
            <FavoriteButton
              teacherId={card.teacherId}
              teacherName={card.teacherName}
              favorite={this.props.favorite}
              onChange={this.props.onFavoriteChange}
              onError={this.props.onFavoriteError}
            />
          ) : null}
        </div>

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

        {card.onVacation ? (
          <p className="booking-card-vacation">El docente está de licencia este día.</p>
        ) : null}
        {this.renderTags()}
        {this.renderPack()}
        {this.renderGroups()}

        <div className="booking-card-actions">
          <span className="booking-card-price">{this.renderRate()}</span>
          <button
            type="button"
            className="btn btn-primary"
            disabled={card.onVacation}
            onClick={this.props.onReservar}
            // Los botones de todas las tarjetas dicen lo mismo: sin esto, leído
            // con un lector de pantalla no se sabe cuál es cuál.
            aria-label={`Reservar con ${card.teacherName}, ${formatRangeLabel(card.start, card.end)}${card.onVacation ? ', de licencia' : ''}`}
          >
            {card.onVacation ? 'De licencia' : 'Reservar'}
          </button>
        </div>
      </li>
    )
  }
}

BookingCard.defaultProps = {
  favorite: false,
  showFavorite: false,
  onFavoriteChange: () => {},
  onFavoriteError: () => {},
}

export default BookingCard

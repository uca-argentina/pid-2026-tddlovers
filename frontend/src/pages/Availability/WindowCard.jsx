import { Component } from 'react'
import {
  BookIcon,
  PencilIcon,
  PinIcon,
  RepeatIcon,
  SpinnerIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
} from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatHourlyRate } from '../../utils/rates.js'
import {
  capacityLabel,
  modalityLabel,
  modalityPlural,
  needsAddress,
  needsMeetingUrl,
  repeatLabel,
} from '../../utils/windows.js'

/**
 * Una ventana en modo lectura, como tarjeta adentro del modal del día: todo
 * lo que el docente cargó, qué materias va a poder elegir el alumno (las que
 * tiene tarifadas en esa modalidad, `subjects`) y los botones para editarla
 * o borrarla.
 *
 * Borrar pide confirmación en la misma tarjeta y no con otro modal encima:
 * un modal arriba de otro es difícil de manejar en el teléfono. Si la
 * ventana se repite, la confirmación lo dice — se borra de todas las semanas.
 *
 * Los estilos están en DayWindowsDialog.css: fuera del modal no significan
 * nada (misma excepción que BookingCard con BookingResults.css).
 */
class WindowCard extends Component {
  renderFacts() {
    const { window } = this.props
    const Icono = window.modality === 'in_person' ? PinIcon : VideoIcon

    return (
      <ul className="window-card-facts">
        <li>
          <Icono />
          {modalityLabel(window.modality)}
        </li>
        <li>
          <UsersIcon />
          {capacityLabel(window.maxStudents)}
        </li>
        {this.props.subjects.length > 0 ? (
          <li className="window-card-wide">
            <BookIcon />
            {this.props.subjects
              .map((rate) => `${rate.subjectName} (${formatHourlyRate(rate.hourlyRateCents)})`)
              .join(', ')}
          </li>
        ) : null}
        {needsAddress(window.modality) && window.locality ? (
          <li className="window-card-wide">
            <PinIcon />
            {window.locality}
          </li>
        ) : null}
        {needsAddress(window.modality) && window.address ? (
          <li className="window-card-wide window-card-private">
            {window.address}
            <span className="window-card-private-note">(solo la ven quienes reservan)</span>
          </li>
        ) : null}
        {needsMeetingUrl(window.modality) && window.meetingUrl ? (
          <li className="window-card-wide">
            <VideoIcon />
            <a href={window.meetingUrl} target="_blank" rel="noreferrer">
              {window.meetingUrl}
            </a>
          </li>
        ) : null}
      </ul>
    )
  }

  renderActions() {
    const { window, readOnly, confirming, deleting, onEdit, onAskDelete, onCancelDelete, onDelete } =
      this.props
    if (readOnly) return null

    if (confirming) {
      return (
        <div className="window-card-confirm" role="group" aria-label="Confirmar">
          <p>
            ¿Eliminar este horario?
            {window.repeatsWeekly ? ' Se borra de todas las semanas.' : ''}
            {/* Las clases ya reservadas quedan: tienen todo copiado. */}
            {' '}Las clases ya reservadas no se cancelan.
          </p>
          <div className="window-card-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={onCancelDelete}
              disabled={deleting}
            >
              No
            </button>
            <button type="button" className="btn btn-danger" onClick={onDelete} disabled={deleting}>
              {deleting ? <SpinnerIcon className="spin" /> : null}
              Sí, eliminar
            </button>
          </div>
        </div>
      )
    }

    return (
      <div className="window-card-actions">
        <button
          type="button"
          className="window-card-icon-btn"
          onClick={onEdit}
          aria-label={`Editar el horario de ${window.start} a ${window.end}`}
        >
          <PencilIcon />
          Editar
        </button>
        <button
          type="button"
          className="window-card-icon-btn is-danger"
          onClick={onAskDelete}
          aria-label={`Eliminar el horario de ${window.start} a ${window.end}`}
        >
          <TrashIcon />
          Eliminar
        </button>
      </div>
    )
  }

  render() {
    const { window, focused, subjects, cardRef } = this.props

    return (
      <li className={`window-card ${focused ? 'is-focused' : ''}`} ref={cardRef}>
        <div className="window-card-head">
          <span className="window-card-time">{formatRangeLabel(window.start, window.end)}</span>
          {window.repeatsWeekly ? (
            <span className="window-card-badge">
              <RepeatIcon />
              {repeatLabel(window)}
            </span>
          ) : null}
        </div>

        {this.renderFacts()}

        {/* La ventana queda guardada pero el tablero no la ofrece (ver
            findPublishedWindows): sin esto el docente no sabría por qué nadie
            reserva. Pasa si borró las tarifas de esa modalidad después. */}
        {subjects.length === 0 ? (
          <p className="window-card-warning">
            No tenés tarifas para clases {modalityPlural(window.modality)}: los alumnos no ven este
            horario. Cargalas desde tu perfil.
          </p>
        ) : null}

        {this.renderActions()}
      </li>
    )
  }
}

WindowCard.defaultProps = {
  readOnly: false,
  focused: false,
  subjects: [],
  confirming: false,
  deleting: false,
  cardRef: undefined,
}

export default WindowCard

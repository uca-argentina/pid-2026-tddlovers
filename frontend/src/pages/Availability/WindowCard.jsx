import { Component } from 'react'
import {
  ClockIcon,
  PencilIcon,
  PinIcon,
  RepeatIcon,
  SpinnerIcon,
  TrashIcon,
  UsersIcon,
  VideoIcon,
} from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import {
  capacityLabel,
  formatMinutes,
  formatPrice,
  modalityLabel,
  needsAddress,
  needsMeetingUrl,
  repeatLabel,
} from '../../utils/windows.js'

/**
 * Una ventana en modo lectura, como tarjeta adentro del modal del día: todo
 * lo que el docente cargó, y los botones para editarla o borrarla.
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
          <ClockIcon />
          Clases de {formatMinutes(window.durationMinutes)}
        </li>
        <li>
          <Icono />
          {modalityLabel(window.modality)}
        </li>
        <li>
          <UsersIcon />
          {capacityLabel(window.maxStudents)}
        </li>
        <li className="window-card-price">
          {formatPrice(window.price)}
          {window.maxStudents > 1 && window.price > 0 ? ' por alumno' : ''}
        </li>
        {needsAddress(window.modality) && window.address ? (
          <li className="window-card-wide">
            <PinIcon />
            {window.address}
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
            ¿Eliminar esta clase?
            {window.repeatsWeekly ? ' Se borra de todas las semanas.' : ''}
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
          aria-label={`Editar la clase de ${window.subjectName} de ${window.start} a ${window.end}`}
        >
          <PencilIcon />
          Editar
        </button>
        <button
          type="button"
          className="window-card-icon-btn is-danger"
          onClick={onAskDelete}
          aria-label={`Eliminar la clase de ${window.subjectName} de ${window.start} a ${window.end}`}
        >
          <TrashIcon />
          Eliminar
        </button>
      </div>
    )
  }

  render() {
    const { window, focused, notTaught, cardRef } = this.props

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
        <p className="window-card-subject">{window.subjectName}</p>

        {this.renderFacts()}

        {/* La ventana queda guardada pero el tablero no la ofrece (ver
            findPublishedWindows): sin esto el docente no sabría por qué nadie
            reserva. */}
        {notTaught ? (
          <p className="window-card-warning">
            Ya no tenés esta materia en tu perfil: los alumnos no ven esta clase.
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
  notTaught: false,
  confirming: false,
  deleting: false,
  cardRef: undefined,
}

export default WindowCard

import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { bookLesson } from '../../api/client.js'
import { formatDayLongWithYear, fromISODate } from '../../utils/calendar.js'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatEnrolled } from '../../utils/booking.js'
import {
  capacityLabel,
  formatMinutes,
  formatPrice,
  modalityLabel,
  needsAddress,
  needsMeetingUrl,
  toMinutes,
} from '../../utils/windows.js'
import './BookingDialog.css'

/**
 * El paso final: elegir a qué hora y confirmar. La materia, la duración y la
 * modalidad ya vienen de la clase que ofrece el docente; acá no se eligen.
 *
 * Los horarios son botones y no una línea de tiempo: con duraciones
 * distintas y turnos grupales a los que sumarse, lo que el alumno decide es
 * "cuál de estos", y una lista de opciones lo dice más claro que una barra.
 * Van en dos grupos cuando hay grupales armadas — sumarse a una clase que ya
 * tiene gente no es lo mismo que abrir una nueva.
 *
 * Acá NO se vuelve a calcular qué está libre: la tarjeta ya trae los turnos
 * (del backend) marcados con lo que choca con clases propias (de
 * annotateClashes). Una segunda cuenta sería una segunda verdad.
 */
class BookingDialog extends Component {
  constructor(props) {
    super(props)
    const libres = props.card.slots.filter((slot) => !slot.blocked)
    // Si hay un solo horario posible no tiene sentido hacerlo elegir.
    this.state = {
      start: libres.length === 1 ? libres[0].start : null,
      saving: false,
      error: null,
    }
  }

  getSelected() {
    return this.props.card.slots.find((slot) => slot.start === this.state.start) || null
  }

  handleSelect = (start) => () => {
    this.setState({ start, error: null })
  }

  handleConfirm = () => {
    const { card, onBooked } = this.props
    const { start, saving } = this.state
    if (start === null || saving) return

    this.setState({ saving: true, error: null })

    bookLesson({ windowId: card.windowId, date: card.date, startTime: start })
      .then(() => onBooked({ subjectName: card.subject.name, teacherName: card.teacherName }))
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo reservar la clase. Probá de nuevo.',
        })
      })
  }

  /** Por qué un horario no se puede tomar, para el lector de pantalla. */
  describeSlot(slot) {
    const rango = `${slot.start} a ${slot.end}`
    const grupo =
      slot.enrolled > 0 ? `, ${formatEnrolled(slot.enrolled, this.props.card.maxStudents)}` : ''
    if (slot.joined) return `${rango}${grupo}, ya estás anotado`
    if (slot.blocked) return `${rango}${grupo}, ya tenés otra clase`
    return `${rango}${grupo}`
  }

  renderSlots(title, slots) {
    if (slots.length === 0) return null
    const { card } = this.props

    return (
      <fieldset className="booking-dialog-slots">
        <legend>{title}</legend>
        <div className="booking-dialog-slot-list">
          {slots.map((slot) => {
            const elegido = slot.start === this.state.start
            return (
              <button
                key={slot.start}
                type="button"
                className={`booking-slot ${elegido ? 'is-selected' : ''} ${slot.enrolled > 0 ? 'is-group' : ''}`}
                aria-pressed={elegido}
                aria-label={this.describeSlot(slot)}
                onClick={this.handleSelect(slot.start)}
                disabled={slot.blocked || this.state.saving}
              >
                <span className="booking-slot-time">{formatRangeLabel(slot.start, slot.end)}</span>
                {slot.enrolled > 0 ? (
                  <span className="booking-slot-note">
                    {slot.joined ? 'Ya estás anotado' : formatEnrolled(slot.enrolled, card.maxStudents)}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  renderSummary() {
    const slot = this.getSelected()
    const { card } = this.props
    if (!slot) {
      return <p className="booking-dialog-hint">Elegí a qué hora querés la clase.</p>
    }

    // Del turno y no de la ventana: una grupal armada antes de que el docente
    // cambiara la duración conserva la suya.
    const duracion = formatMinutes(toMinutes(slot.end) - toMinutes(slot.start))
    return (
      <p className="booking-dialog-pick">
        {formatRangeLabel(slot.start, slot.end)}
        <span className="booking-dialog-duration">
          {` · ${duracion} · ${card.subject.name}`}
          {slot.enrolled > 0 ? ' · te sumás a una clase grupal' : ''}
        </span>
      </p>
    )
  }

  render() {
    const { card, onClose } = this.props
    const { start, saving, error } = this.state
    const grupos = card.slots.filter((slot) => slot.enrolled > 0)
    const nuevos = card.slots.filter((slot) => slot.enrolled === 0)

    return (
      <Modal title="Reservar clase" onClose={onClose}>
        <div className="booking-dialog">
          <dl className="booking-dialog-details">
            <div>
              <dt>Materia</dt>
              <dd>{card.subject.name}</dd>
            </div>
            <div>
              <dt>Docente</dt>
              <dd>{card.teacherName}</dd>
            </div>
            <div>
              <dt>Día</dt>
              <dd>{formatDayLongWithYear(fromISODate(card.date))}</dd>
            </div>
            <div>
              <dt>Modalidad</dt>
              <dd>{modalityLabel(card.modality)}</dd>
            </div>
            <div>
              <dt>Cupo</dt>
              <dd>{capacityLabel(card.maxStudents)}</dd>
            </div>
            <div>
              <dt>Precio</dt>
              <dd>{formatPrice(card.price)}</dd>
            </div>
            {needsAddress(card.modality) && card.address ? (
              <div className="booking-dialog-wide">
                <dt>Dirección</dt>
                <dd>{card.address}</dd>
              </div>
            ) : null}
          </dl>

          {/* El link no viaja en la disponibilidad: se lo lleva el que reserva. */}
          {needsMeetingUrl(card.modality) ? (
            <p className="booking-dialog-note">
              El link de la videollamada te aparece en tu calendario cuando reserves.
            </p>
          ) : null}

          {this.renderSlots('Sumate a una clase grupal', grupos)}
          {this.renderSlots(grupos.length > 0 ? 'O empezá una nueva' : 'Elegí el horario', nuevos)}

          {this.renderSummary()}

          {error ? <Banner type="danger">{error}</Banner> : null}

          <div className="booking-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleConfirm}
              disabled={start === null || saving}
            >
              {saving ? <SpinnerIcon className="spin" /> : null}
              {saving ? 'Reservando...' : 'Confirmar reserva'}
            </button>
          </div>
        </div>
      </Modal>
    )
  }
}

export default BookingDialog

import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import HourTimeline from './HourTimeline.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { bookLesson } from '../../api/client.js'
import { formatDayLongWithYear, fromISODate } from '../../utils/calendar.js'
import { formatRangeLabel, slotIndexToTime, SLOTS_PER_CLASS } from '../../utils/availability.js'
import { startOptions } from '../../utils/booking.js'
import './BookingDialog.css'

/**
 * El paso final: elegir a qué hora arranca la clase y confirmarla.
 *
 * Acá NO se vuelve a calcular qué está libre. La tarjeta ya trae `free` (los
 * tramos que quedan después de sacar lo reservado con ese docente y lo que el
 * alumno tiene con otros) y `ranges` (lo que el docente ofrece ese día); de
 * esos dos sale todo lo que se pinta. Una segunda cuenta acá sería una segunda
 * verdad, que es justo lo que se evitó al poner el puente en booking.js.
 *
 * La hora se guarda como ÍNDICE de media hora y recién se pasa a 'HH:MM' al
 * confirmar, porque la línea de tiempo dibuja por índice.
 */
class BookingDialog extends Component {
  state = {
    start: null,
    saving: false,
    error: null,
  }

  componentDidMount() {
    // Si hay un solo arranque posible no tiene sentido hacerlo elegir: se
    // marca solo y el modal queda listo para confirmar.
    const opciones = startOptions(this.props.card.free)
    if (opciones.length === 1) this.setState({ start: opciones[0] })
  }

  /** Las clases que el alumno ya tiene ese día, sean de quien sean. */
  getBusy() {
    return this.props.myLessons.filter((lesson) => lesson.date === this.props.card.date)
  }

  handleSelect = (index) => {
    this.setState({ start: index, error: null })
  }

  handleConfirm = () => {
    const { card, onBooked } = this.props
    const { start, saving } = this.state
    if (start === null || saving) return

    this.setState({ saving: true, error: null })

    bookLesson({
      date: card.date,
      teacherId: card.teacherId,
      teacherName: card.teacherName,
      subjectId: card.subjectId,
      subjectName: card.subjectName,
      startTime: slotIndexToTime(start),
      endTime: slotIndexToTime(start + SLOTS_PER_CLASS),
      status: 'reservada',
    })
      .then(() => onBooked())
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo reservar la clase. Probá de nuevo.',
        })
      })
  }

  renderSummary() {
    const { start } = this.state
    if (start === null) {
      return <p className="booking-dialog-hint">Elegí en qué hora querés que arranque la clase.</p>
    }

    return (
      <p className="booking-dialog-pick">
        {formatRangeLabel(slotIndexToTime(start), slotIndexToTime(start + SLOTS_PER_CLASS))}
        <span className="booking-dialog-duration"> · 1 h</span>
      </p>
    )
  }

  render() {
    const { card, onClose } = this.props
    const { start, saving, error } = this.state

    // Ancho: con las 24 h del día en una sola línea, cada media hora es una
    // franja finita y cuanto más lugar tenga, más fácil es leerla.
    return (
      <Modal title="Reservar clase" onClose={onClose} wide>
        <div className="booking-dialog">
          <dl className="booking-dialog-details">
            <div>
              <dt>Materia</dt>
              <dd>{card.subjectName}</dd>
            </div>
            <div>
              <dt>Docente</dt>
              <dd>{card.teacherName}</dd>
            </div>
            <div>
              <dt>Día</dt>
              <dd>{formatDayLongWithYear(fromISODate(card.date))}</dd>
            </div>
          </dl>

          <HourTimeline
            ranges={card.ranges}
            free={card.free}
            busy={this.getBusy()}
            value={start}
            onSelect={this.handleSelect}
          />

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

BookingDialog.defaultProps = {
  myLessons: [],
}

export default BookingDialog

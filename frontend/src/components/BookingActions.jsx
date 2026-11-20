import { Component } from 'react'
import { Link } from 'react-router-dom'
import Modal from './Modal.jsx'
import Banner from './Banner.jsx'
import { SpinnerIcon } from './icons.jsx'
import { acceptBooking, cancelBooking, markAttendance, payBooking } from '../api/client.js'
import {
  STATUS_TONES,
  allowedActions,
  cancelDeadlineHint,
  cancelDescription,
  nowParts,
  owesPayment,
  statusLabel,
} from '../utils/bookingStates.js'
import { rewardLabel } from '../utils/neuronas.js'
import './ClassActions.css'

/**
 * El estado de una reserva y los botones de lo que se puede hacer con ella,
 * según quién mira. Lo usan el calendario y "Mis reservas", así que las dos
 * pantallas muestran y permiten exactamente lo mismo.
 *
 * Qué botones aparecen lo decide allowedActions (utils/bookingStates.js), pero
 * es solo para no ofrecer lo imposible: el backend vuelve a chequear todo, y
 * si algo cambió en el medio (el otro la canceló, pasaron las 24 h) se
 * muestra su mensaje.
 *
 * Cuando una acción sale bien avisa con onChange(claseActualizada): quien la
 * muestra decide qué hacer (reemplazarla en su lista, sacarla si se canceló).
 *
 * En la práctica la usa el alumno: ClassCard y DayAgenda (con
 * exclude={['attend']}) y ClassDetailDialog (viewRole "student"); el docente
 * usa ClassActions.
 *
 * Props: booking (una reserva de GET /api/bookings), viewRole, exclude (acciones a
 * esconder), now (inyectable para tests) y
 * onChange(reservaActualizada).
 *
 * Datos (api/client.js), cada uno devuelve la reserva actualizada:
 *   acceptBooking → POST /api/bookings/:id/accept, payBooking → …/pay,
 *   cancelBooking → …/cancel, markAttendance → …/attendance. Reprogramar es
 *   un link a /disponibilidad?reprogramar=<id> (BookingBoard).
 *
 * Estado: busy (acción en vuelo), error, confirmingCancel.
 */
class BookingActions extends Component {
  state = {
    // La acción en vuelo ('accept', 'pay', ...), para el spinner y para no
    // mandar dos veces.
    busy: null,
    error: null,
    confirmingCancel: false,
  }

  /** Corre `call()` (un pedido a la API) y le pasa la reserva devuelta a onChange. */
  run(action, call) {
    if (this.state.busy) return
    this.setState({ busy: action, error: null })
    call()
      .then((updated) => {
        this.setState({ busy: null, confirmingCancel: false })
        this.props.onChange(updated)
      })
      .catch((error) => {
        this.setState({
          busy: null,
          confirmingCancel: false,
          error: error.message || 'No se pudo actualizar la clase. Probá de nuevo.',
        })
      })
  }

  handleAccept = () => this.run('accept', () => acceptBooking(this.props.booking.id))

  handlePay = () => this.run('pay', () => payBooking(this.props.booking.id))

  handleAttend = (attended) => () =>
    this.run(attended ? 'present' : 'absent', () => markAttendance(this.props.booking.id, attended))

  handleAskCancel = () => this.setState({ confirmingCancel: true, error: null })

  handleCloseCancel = () => this.setState({ confirmingCancel: false })

  handleCancel = () => this.run('cancel', () => cancelBooking(this.props.booking.id))

  /** El docente que dice que no a una pendiente la rechaza; lo demás es cancelar. */
  isRejecting() {
    return this.props.viewRole === 'teacher' && this.props.booking.status === 'pendiente'
  }

  renderButton(action, label, onClick, variant = 'secondary') {
    const { busy } = this.state
    return (
      <button
        type="button"
        className={`class-action is-${variant}`}
        onClick={onClick}
        disabled={Boolean(busy)}
      >
        {busy === action ? <SpinnerIcon className="spin" /> : null}
        {label}
      </button>
    )
  }

  renderButtons(actions) {
    const { booking } = this.props
    const botones = []

    if (actions.includes('accept')) {
      botones.push(this.renderButton('accept', 'Aceptar', this.handleAccept, 'primary'))
    }
    if (actions.includes('pay')) {
      botones.push(this.renderButton('pay', 'Pagar', this.handlePay, 'primary'))
    }
    if (actions.includes('attend')) {
      // Si ya tomó lista, se ofrece solo la otra marca, para corregir.
      if (booking.status !== 'realizada') {
        botones.push(this.renderButton('present', 'Presente', this.handleAttend(true), 'primary'))
      }
      if (booking.status !== 'no_presentada') {
        botones.push(this.renderButton('absent', 'Ausente', this.handleAttend(false)))
      }
    }
    if (actions.includes('reschedule')) {
      // Un link y no un botón: reprogramar es elegir otro horario en la
      // pantalla de reservar, que ya sabe mostrar los del docente.
      botones.push(
        <Link
          key="reschedule"
          className="class-action is-secondary"
          to={`/disponibilidad?reprogramar=${encodeURIComponent(booking.id)}`}
        >
          Reprogramar
        </Link>,
      )
    }
    if (actions.includes('cancel')) {
      const label = this.isRejecting() ? 'Rechazar' : 'Cancelar clase'
      botones.push(this.renderButton('cancel', label, this.handleAskCancel, 'danger'))
    }

    if (botones.length === 0) return null
    return (
      <div className="class-actions-buttons">
        {botones.map((boton, i) => (
          <span key={i} className="class-actions-slot">
            {boton}
          </span>
        ))}
      </div>
    )
  }

  renderCancelDialog() {
    const { booking, viewRole } = this.props
    const rechazar = this.isRejecting()
    const titulo = rechazar ? '¿Rechazar la reserva?' : '¿Cancelar la clase?'
    let detalle = 'Se libera el horario y no se puede deshacer.'
    if (viewRole === 'student' && booking.status === 'confirmada') {
      detalle = 'Ya la pagaste. Se libera el horario y no se puede deshacer.'
    }

    return (
      <Modal title={titulo} onClose={this.handleCloseCancel}>
        <p className="class-actions-confirm-text">
          {booking.subjectName} · {detalle}
        </p>
        <div className="class-actions-confirm-row">
          <button type="button" className="class-action is-secondary" onClick={this.handleCloseCancel}>
            Volver
          </button>
          <button
            type="button"
            className="class-action is-danger"
            onClick={this.handleCancel}
            disabled={Boolean(this.state.busy)}
          >
            {this.state.busy === 'cancel' ? <SpinnerIcon className="spin" /> : null}
            {rechazar ? 'Sí, rechazar' : 'Sí, cancelar'}
          </button>
        </div>
      </Modal>
    )
  }

  render() {
    const { booking, viewRole } = this.props
    const now = this.props.now || nowParts()
    // FILTRO: los botones salen de allowedActions (espejo de checkAction del
    // backend); `exclude` saca acciones que se hacen en otro lado: en las
    // tarjetas, tomar lista va en el detalle de la clase (ClassDetailDialog).
    const actions = allowedActions(booking, viewRole, now).filter((a) => !this.props.exclude.includes(a))
    const motivo = cancelDescription(booking, viewRole)
    const hint = viewRole === 'student' ? cancelDeadlineHint(booking, now) : null
    const tone = STATUS_TONES[booking.status] || 'muted'

    return (
      <div className="class-actions">
        <div className="class-actions-status">
          <span className={`class-status is-${tone}`}>{statusLabel(booking.status)}</span>
          {/* En una aceptada la deuda ya la dice el botón de pagar (y el
              docente la ve en la pastilla). En una clase ya dada, no: puede
              haber quedado sin pagar. */}
          {owesPayment(booking) && booking.status !== 'aceptada' ? (
            <span className="class-status is-warning">Pago pendiente</span>
          ) : null}
          {viewRole === 'teacher' && booking.status === 'aceptada' ? (
            <span className="class-status is-muted">Sin pagar</span>
          ) : null}
          {/* Lo que cubre el paquete no se paga; la asistencia descuenta las
              clases del paquete que usó. */}
          {booking.packTokens > 0 ? (
            <span className="class-status is-info">
              {booking.packTokens === 1 ? '1 clase' : `${booking.packTokens} clases`} del paquete
            </span>
          ) : null}
          {booking.rewardType ? (
            <span className="class-status is-info">{rewardLabel(booking.rewardType)} con neuronas</span>
          ) : null}
        </div>

        {motivo ? <p className="class-actions-note">{motivo}</p> : null}
        {hint ? <p className="class-actions-note">{hint}</p> : null}
        {this.state.error ? <Banner type="danger">{this.state.error}</Banner> : null}

        {this.renderButtons(actions)}
        {this.state.confirmingCancel ? this.renderCancelDialog() : null}
      </div>
    )
  }
}

BookingActions.defaultProps = {
  viewRole: 'student',
  exclude: [],
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default BookingActions

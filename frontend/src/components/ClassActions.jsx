import { Component } from 'react'
import { Link } from 'react-router-dom'
import Modal from './Modal.jsx'
import Banner from './Banner.jsx'
import { SpinnerIcon } from './icons.jsx'
import { acceptLesson, cancelLesson, markAttendance, payLesson } from '../api/client.js'
import {
  STATUS_TONES,
  allowedActions,
  cancelDeadlineHint,
  cancelDescription,
  nowParts,
  owesPayment,
  statusLabel,
} from '../utils/classStates.js'
import './ClassActions.css'

/**
 * El estado de una reserva y los botones de lo que se puede hacer con ella,
 * según quién mira. Lo usan el calendario y "Mis reservas", así que las dos
 * pantallas muestran y permiten exactamente lo mismo.
 *
 * Qué botones aparecen lo decide allowedActions (utils/classStates.js), pero
 * es solo para no ofrecer lo imposible: el backend vuelve a chequear todo, y
 * si algo cambió en el medio (el otro la canceló, pasaron las 24 h) se
 * muestra su mensaje.
 *
 * Cuando una acción sale bien avisa con onChange(claseActualizada): quien la
 * muestra decide qué hacer (reemplazarla en su lista, sacarla si se canceló).
 */
class ClassActions extends Component {
  state = {
    // La acción en vuelo ('accept', 'pay', ...), para el spinner y para no
    // mandar dos veces.
    busy: null,
    error: null,
    confirmingCancel: false,
  }

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

  handleAccept = () => this.run('accept', () => acceptLesson(this.props.cls.id))

  handlePay = () => this.run('pay', () => payLesson(this.props.cls.id))

  handleAttend = (attended) => () =>
    this.run(attended ? 'present' : 'absent', () => markAttendance(this.props.cls.id, attended))

  handleAskCancel = () => this.setState({ confirmingCancel: true, error: null })

  handleCloseCancel = () => this.setState({ confirmingCancel: false })

  handleCancel = () => this.run('cancel', () => cancelLesson(this.props.cls.id))

  /** El docente que dice que no a una pendiente la rechaza; lo demás es cancelar. */
  isRejecting() {
    return this.props.viewRole === 'teacher' && this.props.cls.status === 'pendiente'
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
    const { cls } = this.props
    const botones = []

    if (actions.includes('accept')) {
      botones.push(this.renderButton('accept', 'Aceptar', this.handleAccept, 'primary'))
    }
    if (actions.includes('pay')) {
      botones.push(this.renderButton('pay', 'Confirmar (pagar)', this.handlePay, 'primary'))
    }
    if (actions.includes('attend')) {
      // Si ya tomó lista, se ofrece solo la otra marca, para corregir.
      if (cls.status !== 'realizada') {
        botones.push(this.renderButton('present', 'Estuvo', this.handleAttend(true), 'primary'))
      }
      if (cls.status !== 'no_presentada') {
        botones.push(this.renderButton('absent', 'No vino', this.handleAttend(false)))
      }
    }
    if (actions.includes('reschedule')) {
      // Un link y no un botón: reprogramar es elegir otro horario en la
      // pantalla de reservar, que ya sabe mostrar los del docente.
      botones.push(
        <Link
          key="reschedule"
          className="class-action is-secondary"
          to={`/disponibilidad?reprogramar=${encodeURIComponent(cls.id)}`}
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
    const { cls, viewRole } = this.props
    const rechazar = this.isRejecting()
    const titulo = rechazar ? '¿Rechazar la reserva?' : '¿Cancelar la clase?'
    let detalle = 'Se libera el horario y no se puede deshacer.'
    if (viewRole === 'student' && cls.status === 'confirmada') {
      detalle = 'Ya la pagaste. Se libera el horario y no se puede deshacer.'
    }

    return (
      <Modal title={titulo} onClose={this.handleCloseCancel}>
        <p className="class-actions-confirm-text">
          {cls.subjectName} · {detalle}
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
    const { cls, viewRole, label } = this.props
    const now = this.props.now || nowParts()
    const actions = allowedActions(cls, viewRole, now)
    const motivo = cancelDescription(cls, viewRole)
    const hint = viewRole === 'student' ? cancelDeadlineHint(cls, now) : null
    const tone = STATUS_TONES[cls.status] || 'muted'

    return (
      <div className="class-actions">
        <div className="class-actions-status">
          {label ? <span className="class-actions-label">{label}</span> : null}
          <span className={`class-status is-${tone}`}>{statusLabel(cls.status)}</span>
          {/* En una aceptada la deuda ya la dice el botón de pagar (y el
              docente la ve en la pastilla). En una clase ya dada, no: puede
              haber quedado sin pagar. */}
          {owesPayment(cls) && cls.status !== 'aceptada' ? (
            <span className="class-status is-warning">Pago pendiente</span>
          ) : null}
          {viewRole === 'teacher' && cls.status === 'aceptada' ? (
            <span className="class-status is-muted">Sin pagar</span>
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

ClassActions.defaultProps = {
  viewRole: 'student',
  label: null,
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default ClassActions

import { Component } from 'react'
import Modal from './Modal.jsx'
import Banner from './Banner.jsx'
import { SpinnerIcon } from './icons.jsx'
import { acceptTurn, cancelTurn } from '../api/client.js'
import {
  STATUS_TONES,
  allowedActions,
  cancelDescription,
  nowParts,
  statusLabel,
} from '../utils/classStates.js'
import './ClassActions.css'

// El orden de las pastillas: lo que espera algo primero.
const STATUS_ORDER = ['pendiente', 'aceptada', 'confirmada', 'realizada', 'no_presentada']

/**
 * El estado y los botones de una CLASE vista por el docente, que en una
 * grupal son varias reservas (una por alumno). Lo que se hace acá se hace
 * con todas: "Aceptar" acepta a todos los que esperan respuesta y "Cancelar
 * clase" la cancela para todos. Decidir alumno por alumno (aceptar a uno,
 * rechazar a otro) y tomar lista va en el detalle de la clase.
 *
 * Va en un solo pedido por la clase entera (POST /:id/turn/...), que el
 * backend aplica todo o nada: o se acepta (o cancela) a todos, o a ninguno.
 * Cada reserva actualizada se avisa con onChange(reserva).
 */
class TurnActions extends Component {
  state = { busy: null, error: null, confirmingCancel: false }

  now() {
    return this.props.now || nowParts()
  }

  active() {
    return this.props.rows.filter((row) => row.status !== 'cancelada')
  }

  withAction(action) {
    const now = this.now()
    return this.active().filter((row) => allowedActions(row, 'teacher', now).includes(action))
  }

  async runTurn(action, call) {
    const [primera] = this.withAction(action)
    if (this.state.busy || !primera) return
    this.setState({ busy: action, error: null })
    try {
      const updated = await call(primera.id)
      this.setState({ busy: null, confirmingCancel: false })
      for (const row of updated) this.props.onChange(row)
    } catch (error) {
      this.setState({
        busy: null,
        confirmingCancel: false,
        error: error.message || 'No se pudo actualizar la clase. Probá de nuevo.',
      })
    }
  }

  handleAccept = () => this.runTurn('accept', acceptTurn)

  handleAskCancel = () => this.setState({ confirmingCancel: true, error: null })

  handleCloseCancel = () => this.setState({ confirmingCancel: false })

  handleCancel = () => this.runTurn('cancel', cancelTurn)

  /** Si todo lo que se cancelaría espera respuesta, es rechazar; si no, cancelar. */
  isRejecting() {
    return this.withAction('cancel').every((row) => row.status === 'pendiente')
  }

  renderStatus() {
    const active = this.active()
    if (active.length === 0) {
      const motivo = cancelDescription(this.props.rows[0], 'teacher')
      return (
        <>
          <div className="class-actions-status">
            <span className="class-status is-muted">{statusLabel('cancelada')}</span>
          </div>
          {motivo ? <p className="class-actions-note">{motivo}</p> : null}
        </>
      )
    }

    // Una pastilla por estado; en una grupal, con cuántos alumnos están así.
    const grupal = active.length > 1
    return (
      <div className="class-actions-status">
        {STATUS_ORDER.map((status) => {
          const count = active.filter((row) => row.status === status).length
          if (count === 0) return null
          return (
            <span key={status} className={`class-status is-${STATUS_TONES[status]}`}>
              {statusLabel(status)}
              {grupal ? ` · ${count}` : ''}
            </span>
          )
        })}
      </div>
    )
  }

  renderButton(action, label, onClick, variant) {
    return (
      <button
        type="button"
        className={`class-action is-${variant}`}
        onClick={onClick}
        disabled={Boolean(this.state.busy)}
      >
        {this.state.busy === action ? <SpinnerIcon className="spin" /> : null}
        {label}
      </button>
    )
  }

  renderCancelDialog() {
    const rows = this.withAction('cancel')
    const rechazar = this.isRejecting()
    const alumnos = rows.length > 1 ? ` para los ${rows.length} alumnos` : ''
    return (
      <Modal
        title={rechazar ? '¿Rechazar la reserva?' : '¿Cancelar la clase?'}
        onClose={this.handleCloseCancel}
      >
        <p className="class-actions-confirm-text">
          {rows[0]?.subjectName} · Se {rechazar ? 'rechaza' : 'cancela'}
          {alumnos}, se libera el horario y no se puede deshacer.
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
    const aceptables = this.withAction('accept')
    const cancelables = this.withAction('cancel')
    const botones = []
    if (aceptables.length > 0) {
      const label = aceptables.length > 1 ? `Aceptar a los ${aceptables.length}` : 'Aceptar'
      botones.push(this.renderButton('accept', label, this.handleAccept, 'primary'))
    }
    if (cancelables.length > 0) {
      const label = this.isRejecting() ? 'Rechazar' : 'Cancelar clase'
      botones.push(this.renderButton('cancel', label, this.handleAskCancel, 'danger'))
    }

    return (
      <div className="class-actions">
        {this.renderStatus()}
        {this.state.error ? <Banner type="danger">{this.state.error}</Banner> : null}
        {botones.length > 0 ? (
          <div className="class-actions-buttons">
            {botones.map((boton, i) => (
              <span key={i} className="class-actions-slot">
                {boton}
              </span>
            ))}
          </div>
        ) : null}
        {this.state.confirmingCancel ? this.renderCancelDialog() : null}
      </div>
    )
  }
}

TurnActions.defaultProps = {
  // Las reservas del turno; para el docente, una por alumno.
  rows: [],
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default TurnActions

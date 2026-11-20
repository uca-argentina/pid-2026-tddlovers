import { Component } from 'react'
import Modal from './Modal.jsx'
import Banner from './Banner.jsx'
import { SpinnerIcon } from './icons.jsx'
import { acceptLesson, cancelLesson } from '../api/client.js'
import {
  STATUS_TONES,
  allowedActions,
  nowParts,
  paymentStatus,
  statusLabel,
} from '../utils/classStates.js'
import { activeRows } from '../utils/reservations.js'
import './ClassActions.css'
import './AttendanceDialog.css'

/**
 * Los alumnos de una clase grupal, antes de que empiece: un renglón por
 * alumno con su estado, si pagó, y lo que se puede hacer con su reserva
 * (aceptarlo, rechazarlo, sacarlo de la clase). Es para decidir de a uno; lo
 * de toda la clase va en los botones del detalle (TurnActions).
 *
 * Va en su propio modal, como tomar lista, para que una grupal de muchos no
 * llene el detalle. Cada cambio se avisa con onChange(reserva).
 *
 * Rol: docente. Props (de ClassDetailDialog): rows (reservas del turno), now,
 * onChange(reservaActualizada) y onClose().
 *
 * Datos: acceptLesson → POST /api/classes/:id/accept y cancelLesson →
 * POST /api/classes/:id/cancel, de a una reserva; qué botones se ven lo
 * decide allowedActions (utils/classStates.js).
 *
 * Estado: busy (id en vuelo), confirmCancelId, error.
 */
class StudentsDialog extends Component {
  state = {
    // El id de la reserva en vuelo, y el de la que espera confirmar baja.
    busy: null,
    confirmCancelId: null,
    error: null,
  }

  now() {
    return this.props.now || nowParts()
  }

  /**
   * Corre `call(row.id)` (acceptLesson o cancelLesson) y le pasa la reserva
   * devuelta a onChange; si falla deja el mensaje del backend en `error`.
   */
  run(row, call) {
    if (this.state.busy) return
    this.setState({ busy: row.id, error: null })
    call(row.id)
      .then((updated) => {
        this.setState({ busy: null, confirmCancelId: null })
        this.props.onChange(updated)
      })
      .catch((error) =>
        this.setState({
          busy: null,
          confirmCancelId: null,
          error: error.message || 'No se pudo actualizar la reserva. Probá de nuevo.',
        }),
      )
  }

  handleAccept = (row) => () => this.run(row, acceptLesson)

  handleAskCancel = (row) => () => this.setState({ confirmCancelId: row.id, error: null })

  handleKeep = () => this.setState({ confirmCancelId: null })

  handleCancel = (row) => () => this.run(row, cancelLesson)

  renderButtons(row) {
    const { busy, confirmCancelId } = this.state
    const actions = allowedActions(row, 'teacher', this.now())
    const ocupado = Boolean(busy)
    const spinner = busy === row.id ? <SpinnerIcon className="spin" /> : null
    // Decirle que no a uno que espera respuesta es rechazarlo; a uno ya
    // aceptado, sacarlo de la clase.
    const verbo = row.status === 'pendiente' ? 'Rechazar' : 'Cancelar'

    if (confirmCancelId === row.id) {
      return (
        <div className="students-buttons">
          <span className="students-confirm">¿{verbo} a {row.studentName || 'este alumno'}?</span>
          <button type="button" className="class-action is-secondary" onClick={this.handleKeep}>
            No
          </button>
          <button
            type="button"
            className="class-action is-danger"
            onClick={this.handleCancel(row)}
            disabled={ocupado}
          >
            {spinner}
            Sí, {verbo.toLowerCase()}
          </button>
        </div>
      )
    }

    const botones = []
    if (actions.includes('accept')) {
      botones.push(
        <button
          key="accept"
          type="button"
          className="class-action is-primary"
          onClick={this.handleAccept(row)}
          disabled={ocupado}
        >
          {spinner}
          Aceptar
        </button>,
      )
    }
    if (actions.includes('cancel')) {
      botones.push(
        <button
          key="cancel"
          type="button"
          className="class-action is-danger"
          onClick={this.handleAskCancel(row)}
          disabled={ocupado}
        >
          {verbo}
        </button>,
      )
    }
    return botones.length > 0 ? <div className="students-buttons">{botones}</div> : null
  }

  renderRow(row) {
    const pago = paymentStatus(row)
    return (
      <li key={row.id} className="attendance-row students-row">
        <div className="students-info">
          <span className="attendance-name">{row.studentName || 'Sin nombre'}</span>
          <div className="class-actions-status">
            <span className={`class-status is-${STATUS_TONES[row.status] || 'muted'}`}>
              {statusLabel(row.status)}
            </span>
            {/* FILTRO: el pago solo en las reservas en pie (regla de pantalla). */}
            {activeRows(this.props.rows).includes(row) ? (
              <span className={`class-status is-${pago.tone}`}>{pago.label}</span>
            ) : null}
          </div>
        </div>
        {this.renderButtons(row)}
      </li>
    )
  }

  render() {
    const { rows, onClose } = this.props
    const enPie = activeRows(rows)
    const pagaron = enPie.filter((row) => row.paidAt).length

    return (
      <Modal title="Alumnos" onClose={onClose}>
        <p className="attendance-summary">
          {enPie.length} {enPie.length === 1 ? 'anotado' : 'anotados'} · {pagaron}{' '}
          {pagaron === 1 ? 'pagó' : 'pagaron'}
        </p>
        {this.state.error ? <Banner type="danger">{this.state.error}</Banner> : null}
        <ul className="attendance-list">{rows.map((row) => this.renderRow(row))}</ul>
        <div className="attendance-foot">
          <button type="button" className="class-action is-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }
}

StudentsDialog.defaultProps = {
  // Las reservas de la clase (canceladas al final, sin botones).
  rows: [],
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default StudentsDialog

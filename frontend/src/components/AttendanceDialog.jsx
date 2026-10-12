import { Component } from 'react'
import Modal from './Modal.jsx'
import Banner from './Banner.jsx'
import { SpinnerIcon } from './icons.jsx'
import { markAttendance } from '../api/client.js'
import { paymentStatus } from '../utils/classStates.js'
import './ClassActions.css'
import './AttendanceDialog.css'

/**
 * Tomar lista: un renglón por alumno con Presente / Ausente. Va en su propio
 * modal (encima del detalle de la clase) para que una grupal de muchos
 * alumnos no llene el detalle.
 *
 * Cada marca se guarda al tocarla, como antes en la tarjeta: no hay un
 * "Guardar" que olvidarse de apretar. Una marca ya puesta se puede cambiar
 * (corregir es la misma acción). `rows` son las reservas a las que se les
 * puede tomar lista (allowedActions 'attend'); cada cambio sale por
 * onChange(reserva).
 */
class AttendanceDialog extends Component {
  state = {
    // El id de la reserva en vuelo, o 'all' para "Todos presentes".
    busy: null,
    error: null,
  }

  async mark(rows, attended, busy) {
    if (this.state.busy) return
    this.setState({ busy, error: null })
    try {
      for (const row of rows) {
        this.props.onChange(await markAttendance(row.id, attended))
      }
      this.setState({ busy: null })
    } catch (error) {
      this.setState({
        busy: null,
        error: error.message || 'No se pudo guardar la asistencia. Probá de nuevo.',
      })
    }
  }

  handleMark = (row, attended) => () => {
    // Tocar la marca que ya tiene no hace nada: no hay nada que corregir.
    if (row.status === (attended ? 'realizada' : 'no_presentada')) return
    this.mark([row], attended, row.id)
  }

  /** Los que todavía no tienen marca, presentes de una: lo más común en una grupal. */
  handleAllPresent = () => {
    const sinMarca = this.props.rows.filter(
      (row) => !['realizada', 'no_presentada'].includes(row.status),
    )
    this.mark(sinMarca, true, 'all')
  }

  renderRow(row) {
    const { busy } = this.state
    const presente = row.status === 'realizada'
    const ausente = row.status === 'no_presentada'
    const nombre = row.studentName || 'Sin nombre'
    const pago = paymentStatus(row)

    return (
      <li key={row.id} className="attendance-row">
        <div className="attendance-name-block">
          <span className="attendance-name">
            {busy === row.id ? <SpinnerIcon className="spin" /> : null}
            {nombre}
          </span>
          {/* La clase ya pasó: si no pagó, se ve acá (se puede pagar después). */}
          <div className="class-actions-status">
            <span className={`class-status is-${pago.tone}`}>{pago.label}</span>
          </div>
        </div>
        <div className="attendance-toggle" role="group" aria-label={`Asistencia de ${nombre}`}>
          <button
            type="button"
            className={`attendance-option is-present ${presente ? 'is-selected' : ''}`}
            aria-pressed={presente}
            onClick={this.handleMark(row, true)}
            disabled={Boolean(busy)}
          >
            Presente
          </button>
          <button
            type="button"
            className={`attendance-option is-absent ${ausente ? 'is-selected' : ''}`}
            aria-pressed={ausente}
            onClick={this.handleMark(row, false)}
            disabled={Boolean(busy)}
          >
            Ausente
          </button>
        </div>
      </li>
    )
  }

  render() {
    const { rows, onClose } = this.props
    const presentes = rows.filter((row) => row.status === 'realizada').length
    const ausentes = rows.filter((row) => row.status === 'no_presentada').length
    const sinMarca = rows.length - presentes - ausentes

    return (
      <Modal title="Tomar asistencia" onClose={onClose}>
        <p className="attendance-summary">
          {presentes} {presentes === 1 ? 'presente' : 'presentes'} · {ausentes}{' '}
          {ausentes === 1 ? 'ausente' : 'ausentes'}
          {sinMarca > 0 ? ` · ${sinMarca} sin marcar` : ''}
        </p>
        {this.state.error ? <Banner type="danger">{this.state.error}</Banner> : null}
        <ul className="attendance-list">{rows.map((row) => this.renderRow(row))}</ul>
        <div className="attendance-foot">
          {rows.length > 1 && sinMarca > 0 ? (
            <button
              type="button"
              className="class-action is-secondary"
              onClick={this.handleAllPresent}
              disabled={Boolean(this.state.busy)}
            >
              {this.state.busy === 'all' ? <SpinnerIcon className="spin" /> : null}
              Todos presentes
            </button>
          ) : null}
          <button type="button" className="class-action is-primary" onClick={onClose}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }
}

AttendanceDialog.defaultProps = {
  rows: [],
  onChange: () => {},
}

export default AttendanceDialog

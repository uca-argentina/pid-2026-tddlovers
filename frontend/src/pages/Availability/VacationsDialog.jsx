import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import { PlusIcon, SpinnerIcon, TrashIcon } from '../../components/icons.jsx'
import { createVacation, deleteVacation, fetchVacationImpact } from '../../api/client.js'
import { formatVacationRange, vacationDays, vacationRangeError } from '../../utils/vacations.js'
import './VacationsDialog.css'

/**
 * Las vacaciones del docente: los rangos que ya cargó (cada uno se puede
 * borrar, por si se equivocó) y el formulario para agregar otro.
 *
 * Mientras dura un rango, sus horarios no se pueden reservar: los alumnos los
 * ven en gris con "El docente está de vacaciones". Al guardar, las reservas
 * que ya tenía esos días se cancelan solas, así que ANTES de guardar se le
 * dice cuántas van a ser (lo cuenta el backend) y tiene que confirmarlo.
 *
 * Los datos son de TeacherAvailability: después de guardar o borrar se le
 * avisa con onChanged para que recargue la lista y la semana.
 */
class VacationsDialog extends Component {
  state = {
    startDate: '',
    endDate: '',
    // Cuántas reservas se cancelarían con el rango elegido; null mientras no
    // se sabe (rango incompleto o pidiéndolo).
    impact: null,
    impactLoading: false,
    saving: false,
    removing: null,
    error: null,
    notice: null,
  }

  impactToken = 0

  componentWillUnmount() {
    this.impactToken += 1
  }

  getRange() {
    return { startDate: this.state.startDate, endDate: this.state.endDate }
  }

  getRangeError() {
    return vacationRangeError(this.getRange(), this.props.today)
  }

  /** Con un rango válido, pregunta cuántas reservas se caerían. */
  loadImpact() {
    const token = ++this.impactToken
    if (this.getRangeError()) {
      this.setState({ impact: null, impactLoading: false })
      return
    }
    this.setState({ impactLoading: true, impact: null })
    fetchVacationImpact(this.getRange())
      .then((data) => {
        if (token !== this.impactToken) return
        this.setState({ impact: data?.cancelledClasses ?? 0, impactLoading: false })
      })
      .catch(() => {
        // Sin el número se puede guardar igual: el backend dice cuántas
        // canceló en la respuesta.
        if (token === this.impactToken) this.setState({ impact: null, impactLoading: false })
      })
  }

  handleDate = (field) => (event) => {
    const value = event.target.value
    this.setState((prev) => {
      const next = { [field]: value, error: null, notice: null }
      // Elegir el primer día con el último vacío (o antes) propone el mismo
      // día: es lo que se suele querer para un día suelto.
      if (field === 'startDate' && value && (!prev.endDate || prev.endDate < value)) {
        next.endDate = value
      }
      return next
    }, () => this.loadImpact())
  }

  handleSave = (event) => {
    event.preventDefault()
    const rangeError = this.getRangeError()
    if (rangeError || this.state.saving) {
      this.setState({ error: rangeError })
      return
    }

    this.setState({ saving: true, error: null, notice: null })
    createVacation(this.getRange())
      .then((saved) => {
        const canceladas = saved?.cancelledClasses ?? 0
        this.setState({
          saving: false,
          startDate: '',
          endDate: '',
          impact: null,
          notice:
            canceladas === 0
              ? `Listo, cargaste tus vacaciones (${formatVacationRange(saved)}).`
              : `Listo, cargaste tus vacaciones (${formatVacationRange(saved)}) y se ${
                  canceladas === 1 ? 'canceló 1 reserva' : `cancelaron ${canceladas} reservas`
                } de esos días.`,
        })
        this.props.onChanged()
      })
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudieron guardar las vacaciones.',
        })
      })
  }

  handleRemove = (vacation) => () => {
    if (this.state.removing) return
    this.setState({ removing: vacation.id, error: null, notice: null })
    deleteVacation(vacation.id)
      .then(() => {
        this.setState({
          removing: null,
          notice: `Borraste tus vacaciones (${formatVacationRange(vacation)}).`,
        })
        this.props.onChanged()
      })
      .catch((error) => {
        this.setState({
          removing: null,
          error: error.message || 'No se pudieron borrar las vacaciones.',
        })
      })
  }

  renderList() {
    const { vacations, loading } = this.props
    const { removing } = this.state

    if (loading && vacations.length === 0) {
      return (
        <p className="vacations-empty">
          <SpinnerIcon className="spin" />
          Cargando...
        </p>
      )
    }
    if (vacations.length === 0) {
      return <p className="vacations-empty">No tenés vacaciones cargadas.</p>
    }

    return (
      <ul className="vacations-list">
        {vacations.map((vacation) => {
          const dias = vacationDays(vacation)
          return (
            <li key={vacation.id} className="vacation-item">
              <div>
                <span className="vacation-item-range">{formatVacationRange(vacation)}</span>
                <span className="vacation-item-days">{dias === 1 ? '1 día' : `${dias} días`}</span>
              </div>
              <button
                type="button"
                className="vacation-item-remove"
                onClick={this.handleRemove(vacation)}
                disabled={Boolean(removing)}
                aria-label={`Borrar las vacaciones: ${formatVacationRange(vacation)}`}
              >
                {removing === vacation.id ? <SpinnerIcon className="spin" /> : <TrashIcon />}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  renderImpact() {
    const { impact, impactLoading } = this.state
    if (impactLoading) {
      return (
        <p className="vacations-impact">
          <SpinnerIcon className="spin" />
          Revisando tus reservas de esos días...
        </p>
      )
    }
    if (impact === null) return null
    if (impact === 0) {
      return <p className="vacations-impact">No tenés reservas esos días.</p>
    }
    return (
      <Banner type="warning">
        {impact === 1
          ? 'Tenés 1 reserva esos días: se va a cancelar y el alumno va a ver que estás de vacaciones.'
          : `Tenés ${impact} reservas esos días: se van a cancelar y los alumnos van a ver que estás de vacaciones.`}
      </Banner>
    )
  }

  render() {
    const { onClose, today } = this.props
    const { startDate, endDate, saving, error, notice, impact } = this.state
    const listo = !this.getRangeError()

    return (
      <Modal title="Vacaciones" onClose={onClose}>
        <div className="vacations-dialog">
          <p className="vacations-hint">
            Los días de vacaciones tus horarios no se pueden reservar: los alumnos los ven en gris y
            les avisamos que estás de vacaciones.
          </p>

          {notice ? <Banner type="success">{notice}</Banner> : null}

          <section aria-labelledby="vacations-current">
            <h3 className="vacations-subtitle" id="vacations-current">
              Tus vacaciones
            </h3>
            {this.renderList()}
          </section>

          <form className="vacations-form" onSubmit={this.handleSave} noValidate>
            <h3 className="vacations-subtitle">Agregar vacaciones</h3>
            <div className="vacations-dates">
              <label className="vacations-date">
                <span>Desde</span>
                <input
                  type="date"
                  value={startDate}
                  min={today}
                  onChange={this.handleDate('startDate')}
                  disabled={saving}
                />
              </label>
              <label className="vacations-date">
                <span>Hasta</span>
                <input
                  type="date"
                  value={endDate}
                  min={startDate || today}
                  onChange={this.handleDate('endDate')}
                  disabled={saving}
                />
              </label>
            </div>

            {startDate && endDate && this.getRangeError() ? (
              <p className="vacations-error">{this.getRangeError()}</p>
            ) : null}
            {this.renderImpact()}
            {error ? <Banner type="danger">{error}</Banner> : null}

            <button type="submit" className="btn btn-primary" disabled={!listo || saving}>
              {saving ? <SpinnerIcon className="spin" /> : <PlusIcon />}
              {impact > 0 ? 'Guardar y cancelar esas reservas' : 'Guardar vacaciones'}
            </button>
          </form>
        </div>
      </Modal>
    )
  }
}

VacationsDialog.defaultProps = {
  vacations: [],
  loading: false,
}

export default VacationsDialog

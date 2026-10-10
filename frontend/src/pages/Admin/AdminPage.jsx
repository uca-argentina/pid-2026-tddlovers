import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { approveTeacher, fetchTeachersForReview, rejectTeacher } from '../../api/client.js'
import { allowedDecisions, approvalLabel, approvalTone } from '../../utils/approval.js'
import './AdminPage.css'

// Las pestañas, en el orden en que el admin las usa: lo que espera respuesta
// primero. `status` null = todos.
const TABS = [
  { key: 'pending', label: 'Pendientes', status: 'pending' },
  { key: 'approved', label: 'Aprobados', status: 'approved' },
  { key: 'rejected', label: 'Rechazados', status: 'rejected' },
  { key: 'all', label: 'Todos', status: null },
]

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * Panel del administrador: revisar a los docentes antes de que aparezcan en
 * las búsquedas. Un docente nuevo arranca pendiente; acá se lo aprueba o se
 * lo rechaza. Rechazar a uno aprobado lo da de baja (deja de recibir
 * reservas nuevas; las que ya tenía siguen en pie).
 *
 * Qué botones se ven lo decide allowedDecisions (utils/approval.js), que
 * copia las reglas del backend; el backend vuelve a chequear y, si algo
 * cambió en el medio (otro admin), contesta con un mensaje que se muestra en
 * la tarjeta.
 */
class AdminPage extends Component {
  state = {
    tab: 'pending',
    teachers: [],
    loading: true,
    error: null,
    // Por docente: qué acción está en curso y el último error.
    busy: {},
    errors: {},
  }

  fetchToken = 0

  componentDidMount() {
    if (this.esAdmin()) this.load()
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  esAdmin() {
    return this.props.user?.role === 'admin'
  }

  getTab() {
    return TABS.find((tab) => tab.key === this.state.tab) || TABS[0]
  }

  load = () => {
    const token = ++this.fetchToken
    this.setState({ loading: true, error: null, errors: {} })
    fetchTeachersForReview(this.getTab().status)
      .then((teachers) => {
        if (token !== this.fetchToken) return
        this.setState({ teachers: Array.isArray(teachers) ? teachers : [], loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar los docentes.',
        })
      })
  }

  handleTab = (key) => () => {
    if (key === this.state.tab) return
    this.setState({ tab: key }, this.load)
  }

  /**
   * Aprobar o rechazar. Si el docente ya no pertenece a la pestaña que se
   * está mirando (aprobé uno de "Pendientes"), sale de la lista; si no, se
   * actualiza en su lugar.
   */
  handleDecision = (teacher, action) => () => {
    const id = String(teacher.id)
    const call = action === 'approve' ? approveTeacher : rejectTeacher
    this.setState((prev) => ({
      busy: { ...prev.busy, [id]: action },
      errors: { ...prev.errors, [id]: null },
    }))
    call(teacher.id)
      .then((updated) => {
        const filtro = this.getTab().status
        this.setState((prev) => ({
          busy: { ...prev.busy, [id]: null },
          teachers: prev.teachers
            .map((item) => (String(item.id) === id ? { ...item, ...updated } : item))
            .filter((item) => !filtro || item.approvalStatus === filtro),
        }))
      })
      .catch((error) => {
        this.setState((prev) => ({
          busy: { ...prev.busy, [id]: null },
          errors: {
            ...prev.errors,
            [id]: error.message || 'No se pudo guardar la decisión.',
          },
        }))
      })
  }

  renderTeacher(teacher) {
    const id = String(teacher.id)
    const busy = this.state.busy[id]
    const error = this.state.errors[id]
    const decisions = allowedDecisions(teacher.approvalStatus)
    const nombre = [teacher.nombre, teacher.apellido].filter(Boolean).join(' ')
    const materias = (teacher.subjects || []).map((subject) => subject.name).join(', ')

    return (
      <li key={id} className="admin-teacher">
        <div className="admin-teacher-head">
          <span className="admin-teacher-name">{nombre}</span>
          <span className={`admin-status is-${approvalTone(teacher.approvalStatus)}`}>
            {approvalLabel(teacher.approvalStatus)}
          </span>
        </div>
        <p className="admin-teacher-meta">
          {teacher.email}
          {teacher.telefono ? ` · ${teacher.telefono}` : ''}
        </p>
        <p className="admin-teacher-meta">
          {materias ? `Materias: ${materias}` : 'Todavía no eligió materias'}
          {` · ${teacher.ratesCount === 1 ? '1 tarifa' : `${teacher.ratesCount || 0} tarifas`}`}
        </p>
        {teacher.createdAt ? (
          <p className="admin-teacher-meta">
            Se registró el {DATE_FORMAT.format(new Date(teacher.createdAt))}
          </p>
        ) : null}

        {error ? <Banner type="danger">{error}</Banner> : null}

        <div className="admin-teacher-actions">
          {decisions.approve ? (
            <button
              type="button"
              className="admin-action is-primary"
              onClick={this.handleDecision(teacher, 'approve')}
              disabled={Boolean(busy)}
              aria-label={`Aprobar a ${nombre}`}
            >
              {busy === 'approve' ? <SpinnerIcon className="spin" /> : null}
              Aprobar
            </button>
          ) : null}
          {decisions.reject ? (
            <button
              type="button"
              className="admin-action is-danger"
              onClick={this.handleDecision(teacher, 'reject')}
              disabled={Boolean(busy)}
              aria-label={`${teacher.approvalStatus === 'approved' ? 'Dar de baja' : 'Rechazar'} a ${nombre}`}
            >
              {busy === 'reject' ? <SpinnerIcon className="spin" /> : null}
              {teacher.approvalStatus === 'approved' ? 'Dar de baja' : 'Rechazar'}
            </button>
          ) : null}
        </div>
      </li>
    )
  }

  renderBody() {
    const { loading, error, teachers } = this.state
    if (loading) {
      return (
        <p className="admin-empty">
          <SpinnerIcon className="spin" />
          Cargando docentes...
        </p>
      )
    }
    if (error) return <Banner type="danger">{error}</Banner>
    if (teachers.length === 0) {
      return (
        <p className="admin-empty">
          {this.state.tab === 'pending'
            ? 'No hay docentes esperando aprobación.'
            : 'No hay docentes en esta lista.'}
        </p>
      )
    }
    return <ul className="admin-list">{teachers.map((teacher) => this.renderTeacher(teacher))}</ul>
  }

  render() {
    // Sin portero en las rutas (ver App.jsx): quien no es admin ve un cartel
    // en vez del panel. El backend igual le contestaría 403.
    if (!this.esAdmin()) {
      return (
        <div className="admin-page">
          <p className="admin-empty">Esta sección es solo para administradores.</p>
          {this.props.user ? null : (
            <Link className="auth-link" to="/ingresar">
              Ir al login
            </Link>
          )}
        </div>
      )
    }

    return (
      <div className="admin-page">
        <h1 className="admin-title">Docentes</h1>
        <p className="admin-subtitle">
          Aprobá a los docentes para que aparezcan en las búsquedas y puedan recibir reservas.
        </p>

        <div className="admin-tabs" role="group" aria-label="Filtrar por estado">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`admin-tab ${tab.key === this.state.tab ? 'is-active' : ''}`}
              aria-pressed={tab.key === this.state.tab}
              onClick={this.handleTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {this.renderBody()}
      </div>
    )
  }
}

export default AdminPage

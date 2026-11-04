import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import { ChevronLeftIcon, PlusIcon, SpinnerIcon } from '../../components/icons.jsx'
import withViewport from '../../routes/withViewport.jsx'
import { fetchHomeworks } from '../../api/client.js'
import {
  formatDue,
  sortStudentHomeworks,
  submissionCounts,
  submissionStatus,
  targetLabel,
} from '../../utils/homework.js'
import NewHomeworkDialog from './NewHomeworkDialog.jsx'
import StudentHomeworkDialog from './StudentHomeworkDialog.jsx'
import TeacherHomeworkDialog from './TeacherHomeworkDialog.jsx'
import '../../components/ClassActions.css'
import './HomeworkPage.css'

/**
 * "Tareas": el docente asigna y corrige, el alumno entrega. Cada tarjeta abre
 * el detalle, y todo cambio vuelve como la tarea entera y reemplaza a la de
 * la lista.
 *
 * En el teléfono no es una pestaña (no entra en cinco): se llega desde el
 * Perfil, así que arriba va el "‹ Perfil" de iOS para volver.
 */
class HomeworkPage extends Component {
  state = {
    homeworks: [],
    loading: true,
    error: null,
    notice: null,
    openId: null,
    creating: false,
  }

  fetchToken = 0

  componentDidMount() {
    this.load()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.viewRole !== this.props.viewRole) this.load()
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  isTeacher() {
    return this.props.viewRole === 'teacher'
  }

  load() {
    const token = ++this.fetchToken
    if (!['teacher', 'student'].includes(this.props.viewRole)) {
      this.setState({ homeworks: [], loading: false, error: null })
      return
    }
    this.setState({ loading: true, error: null })
    fetchHomeworks()
      .then((homeworks) => {
        if (token !== this.fetchToken) return
        // Al recargar, App arranca como alumno hasta que sabe quién es, y el
        // backend contesta según la sesión: una respuesta de docente en ese
        // rato no se puede mostrar. Sigue cargando: enseguida cambia el rol y
        // se vuelve a pedir.
        if (homeworks.some((row) => Array.isArray(row.submissions) !== this.isTeacher())) return
        this.setState({ homeworks, loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar las tareas.',
        })
      })
  }

  handleOpen = (id) => () => this.setState({ openId: id, notice: null })

  handleClose = () => this.setState({ openId: null })

  handleNew = () => this.setState({ creating: true, notice: null })

  handleCloseNew = () => this.setState({ creating: false })

  handleCreated = (homework) => {
    this.setState((prev) => ({
      homeworks: [homework, ...prev.homeworks],
      creating: false,
      notice: 'Tarea asignada.',
    }))
  }

  handleChange = (homework) => {
    this.setState((prev) => ({
      homeworks: prev.homeworks.map((row) => (row.id === homework.id ? homework : row)),
    }))
  }

  renderBadges(homework) {
    if (this.isTeacher()) {
      const { total, entregadas, porCorregir } = submissionCounts(homework)
      return (
        <>
          <span className="class-status is-muted">
            {entregadas} de {total} {total === 1 ? 'entregó' : 'entregaron'}
          </span>
          {porCorregir > 0 ? (
            <span className="class-status is-info">{porCorregir} por corregir</span>
          ) : null}
        </>
      )
    }
    const { submission } = homework
    const estado = submissionStatus(homework, submission, this.props.now || undefined)
    return (
      <>
        <span className={`class-status is-${estado.tone}`}>{estado.label}</span>
        {submission.isLate ? (
          <span className="class-status is-danger">Fuera de término</span>
        ) : null}
      </>
    )
  }

  renderCard(homework) {
    return (
      <li key={homework.id}>
        <button type="button" className="homework-card" onClick={this.handleOpen(homework.id)}>
          <span className="homework-card-title">{homework.title}</span>
          <span className="homework-card-meta">
            {this.isTeacher() ? targetLabel(homework) : `Con ${homework.teacherName}`}
          </span>
          <span className="homework-card-meta">Entrega: {formatDue(homework)}</span>
          <span className="homework-card-badges">{this.renderBadges(homework)}</span>
        </button>
      </li>
    )
  }

  renderBody() {
    const { loading, homeworks } = this.state
    if (!['teacher', 'student'].includes(this.props.viewRole)) {
      return <p className="homework-empty">Las tareas son para docentes y alumnos.</p>
    }
    if (loading) {
      return (
        <p className="homework-empty">
          <SpinnerIcon className="spin" />
          Cargando tareas...
        </p>
      )
    }
    if (homeworks.length === 0) {
      return (
        <p className="homework-empty">
          {this.isTeacher()
            ? 'Todavía no asignaste tareas.'
            : 'No tenés tareas asignadas por ahora.'}
        </p>
      )
    }
    const lista = this.isTeacher() ? homeworks : sortStudentHomeworks(homeworks)
    return <ul className="homework-list">{lista.map((homework) => this.renderCard(homework))}</ul>
  }

  renderOpen() {
    const homework = this.state.homeworks.find((row) => row.id === this.state.openId)
    if (!homework) return null
    const Dialog = this.isTeacher() ? TeacherHomeworkDialog : StudentHomeworkDialog
    return (
      <Dialog
        homework={homework}
        now={this.props.now}
        onChange={this.handleChange}
        onClose={this.handleClose}
      />
    )
  }

  render() {
    const { error, notice, creating } = this.state
    return (
      <div className="homework-page">
        {this.props.mobile ? (
          <Link to="/perfil" className="homework-back">
            <ChevronLeftIcon />
            Perfil
          </Link>
        ) : null}
        <div className="homework-head">
          <div>
            <h1 className="homework-title">Tareas</h1>
            <p className="homework-subtitle">
              {this.isTeacher()
                ? 'Asigná tareas y corregí las entregas de tus alumnos.'
                : 'Las tareas que te asignaron tus docentes.'}
            </p>
          </div>
          {this.isTeacher() ? (
            <button type="button" className="class-action is-primary" onClick={this.handleNew}>
              <PlusIcon />
              Nueva tarea
            </button>
          ) : null}
        </div>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {notice ? <Banner type="success">{notice}</Banner> : null}
        {this.renderBody()}
        {this.renderOpen()}
        {creating ? (
          <NewHomeworkDialog
            now={this.props.now}
            onCreated={this.handleCreated}
            onClose={this.handleCloseNew}
          />
        ) : null}
      </div>
    )
  }
}

HomeworkPage.defaultProps = {
  viewRole: 'student',
  mobile: false,
  // Inyectable para los tests; en la app es la hora real.
  now: null,
}

export default withViewport(HomeworkPage)

import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import Modal from '../../components/Modal.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { createHomework, fetchHomeworkTargets } from '../../api/client.js'
import { formatDayLong, fromISODate } from '../../utils/calendar.js'
import { nowParts } from '../../utils/classStates.js'
import { MAX_TEXT_LENGTH, MAX_TITLE_LENGTH } from '../../utils/homework.js'
import { homeworkEarns } from '../../utils/neuronas.js'

/**
 * Asignar una tarea a un alumno o a una clase grupal. Solo se ofrecen los
 * alumnos y las grupales del docente: el backend no acepta otros.
 *
 * En una grupal, la tarea les llega a los anotados en este momento.
 */
class NewHomeworkDialog extends Component {
  state = {
    students: [],
    groups: [],
    loading: true,
    kind: 'student',
    studentId: '',
    classId: '',
    title: '',
    description: '',
    dueDate: '',
    dueTime: '23:59',
    saving: false,
    error: null,
  }

  alive = false

  componentDidMount() {
    // Acá y no en el inicializador: StrictMode desmonta y vuelve a montar la
    // misma instancia.
    this.alive = true
    fetchHomeworkTargets()
      .then(({ students, groups }) => {
        if (this.alive) this.setState({ students, groups, loading: false })
      })
      .catch((error) => {
        if (!this.alive) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus alumnos.',
        })
      })
  }

  componentWillUnmount() {
    this.alive = false
  }

  handleField = (name) => (event) => this.setState({ [name]: event.target.value })

  handleKind = (kind) => () => this.setState({ kind })

  canSave() {
    const { kind, studentId, classId, title, dueDate, dueTime, saving } = this.state
    const destino = kind === 'student' ? studentId : classId
    return Boolean(destino && title.trim() && dueDate && dueTime && !saving)
  }

  handleSubmit = (event) => {
    event.preventDefault()
    if (!this.canSave()) return
    const { kind, studentId, classId, title, description, dueDate, dueTime } = this.state
    const destino = kind === 'student' ? { studentId } : { classId }
    this.setState({ saving: true, error: null })
    createHomework({ title, description, dueDate, dueTime, ...destino })
      .then((homework) => this.props.onCreated(homework))
      .catch((error) => {
        if (!this.alive) return
        this.setState({ saving: false, error: error.message || 'No se pudo asignar la tarea.' })
      })
  }

  /** Se avisa antes de asignar, que es cuando todavía se puede cambiar el plazo. */
  earnsNoNeuronas() {
    const { dueDate, dueTime } = this.state
    if (!dueDate || !dueTime) return false
    const { iso, time } = this.props.now || nowParts()
    return !homeworkEarns({ createdAt: `${iso}T${time}:00-03:00`, dueDate, dueTime })
  }

  groupLabel(group) {
    const dia = formatDayLong(fromISODate(group.date))
    const anotados = group.enrolled === 1 ? '1 anotado' : `${group.enrolled} anotados`
    return `${group.subjectName} · ${dia} · ${group.startTime} h · ${anotados}`
  }

  renderTarget() {
    const { kind, students, groups, studentId, classId } = this.state
    if (kind === 'student') {
      if (students.length === 0) {
        return <p className="homework-hint">Todavía no tenés alumnos: aparecen cuando reservan.</p>
      }
      return (
        <label className="homework-label">
          Alumno
          <select
            className="homework-input"
            value={studentId}
            onChange={this.handleField('studentId')}
          >
            <option value="">Elegí un alumno</option>
            {students.map((student) => (
              <option key={student.id} value={student.id}>
                {student.name}
              </option>
            ))}
          </select>
        </label>
      )
    }
    if (groups.length === 0) {
      return <p className="homework-hint">No tenés clases grupales recientes ni por venir.</p>
    }
    return (
      <label className="homework-label">
        Clase grupal
        <select className="homework-input" value={classId} onChange={this.handleField('classId')}>
          <option value="">Elegí una clase</option>
          {groups.map((group) => (
            <option key={group.classId} value={group.classId}>
              {this.groupLabel(group)}
            </option>
          ))}
        </select>
      </label>
    )
  }

  renderForm() {
    const { kind, title, description, dueDate, dueTime, saving } = this.state
    return (
      <form className="homework-dialog" onSubmit={this.handleSubmit}>
        <div className="homework-kinds" role="group" aria-label="A quién le asignás la tarea">
          <button
            type="button"
            className={`class-action ${kind === 'student' ? 'is-primary' : 'is-secondary'}`}
            aria-pressed={kind === 'student'}
            onClick={this.handleKind('student')}
          >
            Un alumno
          </button>
          <button
            type="button"
            className={`class-action ${kind === 'class' ? 'is-primary' : 'is-secondary'}`}
            aria-pressed={kind === 'class'}
            onClick={this.handleKind('class')}
          >
            Clase grupal
          </button>
        </div>
        {this.renderTarget()}
        <label className="homework-label">
          Título
          <input
            className="homework-input"
            value={title}
            maxLength={MAX_TITLE_LENGTH}
            onChange={this.handleField('title')}
          />
        </label>
        <label className="homework-label">
          Consigna
          <textarea
            className="homework-input"
            rows={5}
            value={description}
            maxLength={MAX_TEXT_LENGTH}
            onChange={this.handleField('description')}
          />
        </label>
        <div className="homework-due">
          <label className="homework-label">
            Fecha de entrega
            <input
              className="homework-input"
              type="date"
              min={(this.props.now || nowParts()).iso}
              value={dueDate}
              onChange={this.handleField('dueDate')}
            />
          </label>
          <label className="homework-label">
            Hora
            <input
              className="homework-input"
              type="time"
              value={dueTime}
              onChange={this.handleField('dueTime')}
            />
          </label>
        </div>
        {this.earnsNoNeuronas() ? (
          <p className="homework-hint">Con menos de 24 h de plazo, esta tarea no suma neuronas.</p>
        ) : null}
        <div className="homework-actions">
          <button type="submit" className="class-action is-primary" disabled={!this.canSave()}>
            {saving ? <SpinnerIcon className="spin" /> : null}
            Asignar tarea
          </button>
        </div>
      </form>
    )
  }

  render() {
    const { loading, error } = this.state
    return (
      <Modal title="Nueva tarea" onClose={this.props.onClose} tall>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {loading ? (
          <p className="homework-empty">
            <SpinnerIcon className="spin" />
            Cargando...
          </p>
        ) : (
          this.renderForm()
        )}
      </Modal>
    )
  }
}

NewHomeworkDialog.defaultProps = {
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onCreated: () => {},
}

export default NewHomeworkDialog

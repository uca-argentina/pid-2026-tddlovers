import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import { ChevronRightIcon } from '../../components/icons.jsx'
import { formatDue, submissionStatus, targetLabel } from '../../utils/homework.js'
import TeacherSubmissionDialog from './TeacherSubmissionDialog.jsx'

/** Una tarea vista por el docente: la consigna y la entrega de cada alumno. */
class TeacherHomeworkDialog extends Component {
  state = { submissionId: null }

  handleOpen = (id) => () => this.setState({ submissionId: id })

  handleClose = () => this.setState({ submissionId: null })

  renderRow(submission) {
    const { homework, now } = this.props
    const estado = submissionStatus(homework, submission, now || undefined)
    const contenido = (
      <>
        <span className="homework-row-name">{submission.studentName}</span>
        {submission.isLate ? (
          <span className="class-status is-danger">Fuera de término</span>
        ) : null}
        <span className={`class-status is-${estado.tone}`}>{estado.label}</span>
      </>
    )

    // Sin entrega no hay nada que abrir: ni texto, ni corrección, ni chat.
    if (!submission.submittedAt) {
      return (
        <li key={submission.id}>
          <div className="homework-row">{contenido}</div>
        </li>
      )
    }
    return (
      <li key={submission.id}>
        <button
          type="button"
          className="homework-row is-button"
          onClick={this.handleOpen(submission.id)}
        >
          {contenido}
          <ChevronRightIcon className="homework-row-chevron" />
        </button>
      </li>
    )
  }

  render() {
    const { homework, onChange, onClose } = this.props
    const abierta = homework.submissions.find((row) => row.id === this.state.submissionId)

    return (
      <Modal title={homework.title} onClose={onClose} tall>
        <div className="homework-dialog">
          <div className="homework-facts">
            <span>Entrega: {formatDue(homework)}</span>
            <span>{targetLabel(homework)}</span>
          </div>
          {homework.description ? <p className="homework-text">{homework.description}</p> : null}
          <section className="homework-section">
            <h3 className="homework-section-title">Entregas</h3>
            <ul className="homework-rows">
              {homework.submissions.map((submission) => this.renderRow(submission))}
            </ul>
          </section>
        </div>
        {abierta ? (
          <TeacherSubmissionDialog
            key={abierta.id}
            submission={abierta}
            homework={homework}
            onChange={onChange}
            onClose={this.handleClose}
          />
        ) : null}
      </Modal>
    )
  }
}

TeacherHomeworkDialog.defaultProps = {
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default TeacherHomeworkDialog

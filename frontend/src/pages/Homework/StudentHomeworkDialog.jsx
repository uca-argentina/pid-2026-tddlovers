import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import Modal from '../../components/Modal.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { submitHomework } from '../../api/client.js'
import { MAX_TEXT_LENGTH, formatDue, isPastDue, submissionStatus } from '../../utils/homework.js'
import HomeworkChat from './HomeworkChat.jsx'
import SubmissionContent from './SubmissionContent.jsx'

/**
 * Una tarea vista por el alumno: la consigna, su entrega y, una vez entregada,
 * el chat con el docente. Puede cambiar la entrega hasta que se la corrijan;
 * después del vencimiento también, pero queda fuera de término.
 */
class StudentHomeworkDialog extends Component {
  constructor(props) {
    super(props)
    const { submission } = props.homework
    this.state = {
      text: submission.text,
      linkUrl: submission.linkUrl,
      editing: !submission.submittedAt,
      saving: false,
      error: null,
      fieldError: null,
    }
  }

  handleTextChange = (event) => this.setState({ text: event.target.value, fieldError: null })

  handleLinkChange = (event) => this.setState({ linkUrl: event.target.value, fieldError: null })

  handleEdit = () => this.setState({ editing: true })

  handleSubmit = (event) => {
    event.preventDefault()
    const { text, linkUrl, saving } = this.state
    if (saving) return
    this.setState({ saving: true, error: null, fieldError: null })
    submitHomework(this.props.homework.id, { text, linkUrl })
      .then((homework) => {
        this.setState({ saving: false, editing: false })
        this.props.onChange(homework)
      })
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo guardar la entrega.',
          fieldError: error.fields ? Object.keys(error.fields)[0] : null,
        })
      })
  }

  renderForm() {
    const { homework, now } = this.props
    const { text, linkUrl, saving, fieldError } = this.state
    const yaEntrego = Boolean(homework.submission.submittedAt)
    const vacia = text.trim() === '' && linkUrl.trim() === ''

    return (
      <form className="homework-section" onSubmit={this.handleSubmit}>
        <h3 className="homework-section-title">Tu entrega</h3>
        {isPastDue(homework, now || undefined) ? (
          <Banner type="warning">Ya venció: tu entrega va a quedar fuera de término.</Banner>
        ) : null}
        <label className="homework-label">
          Texto
          <textarea
            className="homework-input"
            rows={5}
            value={text}
            maxLength={MAX_TEXT_LENGTH}
            aria-invalid={fieldError === 'text'}
            onChange={this.handleTextChange}
          />
        </label>
        <label className="homework-label">
          Enlace
          <input
            className="homework-input"
            type="url"
            inputMode="url"
            value={linkUrl}
            placeholder="https://"
            aria-invalid={fieldError === 'linkUrl'}
            onChange={this.handleLinkChange}
          />
        </label>
        <p className="homework-hint">Podés entregar un texto, un enlace o los dos.</p>
        <div className="homework-actions">
          <button type="submit" className="class-action is-primary" disabled={saving || vacia}>
            {saving ? <SpinnerIcon className="spin" /> : null}
            {yaEntrego ? 'Guardar cambios' : 'Entregar'}
          </button>
        </div>
      </form>
    )
  }

  render() {
    const { homework, now, onClose } = this.props
    const { submission } = homework
    const { editing, error } = this.state
    const estado = submissionStatus(homework, submission, now || undefined)
    const entregada = Boolean(submission.submittedAt)
    const corregida = Boolean(submission.correctedAt)

    return (
      <Modal title={homework.title} onClose={onClose} tall>
        <div className="homework-dialog">
          <div className="homework-facts">
            <span className={`class-status is-${estado.tone}`}>{estado.label}</span>
            <span>Entrega: {formatDue(homework)}</span>
            <span>Con {homework.teacherName}</span>
          </div>
          {homework.description ? <p className="homework-text">{homework.description}</p> : null}
          {error ? <Banner type="danger">{error}</Banner> : null}

          {editing ? this.renderForm() : <SubmissionContent submission={submission} />}
          {entregada && !editing && !corregida ? (
            <div className="homework-actions">
              <button type="button" className="class-action is-secondary" onClick={this.handleEdit}>
                Cambiar entrega
              </button>
            </div>
          ) : null}

          {corregida ? (
            <section className="homework-section">
              <h3 className="homework-section-title">Devolución del docente</h3>
              <p className="homework-text">{submission.feedback}</p>
            </section>
          ) : null}

          {entregada ? <HomeworkChat submissionId={submission.id} viewRole="student" /> : null}
        </div>
      </Modal>
    )
  }
}

StudentHomeworkDialog.defaultProps = {
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
}

export default StudentHomeworkDialog

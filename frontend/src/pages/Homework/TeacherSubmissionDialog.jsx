import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import Modal from '../../components/Modal.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { saveHomeworkFeedback } from '../../api/client.js'
import { MAX_TEXT_LENGTH } from '../../utils/homework.js'
import HomeworkChat from './HomeworkChat.jsx'
import SubmissionContent from './SubmissionContent.jsx'

/** La entrega de un alumno vista por el docente: leerla, conversar y corregirla. */
class TeacherSubmissionDialog extends Component {
  state = {
    feedback: this.props.submission.feedback,
    saving: false,
    error: null,
    notice: null,
  }

  handleFeedbackChange = (event) => this.setState({ feedback: event.target.value, notice: null })

  handleSubmit = (event) => {
    event.preventDefault()
    if (this.state.saving) return
    this.setState({ saving: true, error: null, notice: null })
    saveHomeworkFeedback(this.props.submission.id, this.state.feedback)
      .then((homework) => {
        this.setState({ saving: false, notice: 'Devolución guardada.' })
        this.props.onChange(homework)
      })
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo guardar la devolución.',
        })
      })
  }

  render() {
    const { submission, onClose } = this.props
    const { feedback, saving, error, notice } = this.state
    const corregida = Boolean(submission.correctedAt)

    return (
      <Modal title={submission.studentName} onClose={onClose} tall>
        <div className="homework-dialog">
          <SubmissionContent submission={submission} />

          <form className="homework-section" onSubmit={this.handleSubmit}>
            <h3 className="homework-section-title">Devolución</h3>
            {error ? <Banner type="danger">{error}</Banner> : null}
            {notice ? <Banner type="success">{notice}</Banner> : null}
            <textarea
              className="homework-input"
              rows={4}
              value={feedback}
              maxLength={MAX_TEXT_LENGTH}
              aria-label="Devolución"
              placeholder="Qué estuvo bien, qué hay que revisar..."
              onChange={this.handleFeedbackChange}
            />
            <div className="homework-actions">
              <button
                type="submit"
                className="class-action is-primary"
                disabled={saving || feedback.trim() === '' || feedback.trim() === submission.feedback}
              >
                {saving ? <SpinnerIcon className="spin" /> : null}
                {corregida ? 'Actualizar devolución' : 'Corregir'}
              </button>
            </div>
          </form>

          <HomeworkChat submissionId={submission.id} viewRole="teacher" />
        </div>
      </Modal>
    )
  }
}

TeacherSubmissionDialog.defaultProps = {
  onChange: () => {},
}

export default TeacherSubmissionDialog

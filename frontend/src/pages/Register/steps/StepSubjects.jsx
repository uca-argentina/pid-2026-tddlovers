import { Component } from 'react'
import Banner from '../../../components/Banner.jsx'
import SubjectPicker from '../../../components/SubjectPicker.jsx'
import { SpinnerIcon } from '../../../components/icons.jsx'

/**
 * Paso 3 del registro: elegir materias. La pregunta cambia según el rol
 * elegido en el paso anterior (docente da materias, alumno se interesa).
 */
class StepSubjects extends Component {
  getQuestion() {
    return this.props.role === 'teacher' ? '¿Qué materias das?' : '¿Qué materias te interesan?'
  }

  render() {
    const {
      subjects,
      selectedIds,
      onToggle,
      onBack,
      onSubmit,
      loading = false,
      submitting = false,
      error,
    } = this.props

    const disableSubmit = submitting || selectedIds.length === 0

    return (
      <div className="step-subjects">
        <h2>{this.getQuestion()}</h2>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {loading ? (
          <p className="subject-loading">
            <SpinnerIcon className="spin" /> Cargando materias...
          </p>
        ) : (
          <SubjectPicker subjects={subjects} selectedIds={selectedIds} onToggle={onToggle} />
        )}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={submitting}>
            Atrás
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={disableSubmit}
            onClick={onSubmit}
          >
            {submitting ? <SpinnerIcon className="spin" /> : null}
            Registrarme
          </button>
        </div>
      </div>
    )
  }
}

export default StepSubjects

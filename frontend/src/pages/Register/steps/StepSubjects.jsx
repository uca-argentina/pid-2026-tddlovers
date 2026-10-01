import { Component } from 'react'
import Banner from '../../../components/Banner.jsx'
import SubjectPicker from '../../../components/SubjectPicker.jsx'
import { SpinnerIcon } from '../../../components/icons.jsx'

/**
 * Paso 3 del registro: elegir materias. Solo lo ve el docente; el alumno se
 * registra directo desde el paso del rol.
 */
class StepSubjects extends Component {
  render() {
    const {
      subjects,
      selectedIds,
      onToggle,
      onBack,
      onSubmit,
      loading = false,
      loadError,
      onRetry,
      submitting = false,
      error,
    } = this.props

    const disableSubmit = submitting || selectedIds.length === 0

    return (
      <div className="step-subjects">
        <h2>¿Qué materias das?</h2>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {/* Si la carga falló, el selector vacío diría "No se encontraron
            materias" y el docente creería que no hay ninguna: se muestra el
            error y cómo reintentar, en lugar de la lista. */}
        {loading ? (
          <p className="subject-loading">
            <SpinnerIcon className="spin" /> Cargando materias...
          </p>
        ) : loadError ? (
          <div className="subject-load-error">
            <Banner type="danger">{loadError}</Banner>
            <button type="button" className="btn btn-ghost" onClick={onRetry}>
              Reintentar
            </button>
          </div>
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

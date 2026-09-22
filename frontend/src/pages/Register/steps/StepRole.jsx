import { Component } from 'react'
import Banner from '../../../components/Banner.jsx'
import RoleCard from '../../../components/RoleCard.jsx'
import { SpinnerIcon, StudentIcon, TeacherIcon } from '../../../components/icons.jsx'

/**
 * Paso 2 del registro: elegir Docente o Alumno. El alumno no tiene paso de
 * materias, así que acá mismo se registra: el botón pasa a ser el mismo
 * "Registrarme" (con spinner) que usa el docente en el paso 3.
 */
class StepRole extends Component {
  handleNext = () => {
    if (this.props.value && !this.props.submitting) {
      this.props.onNext()
    }
  }

  render() {
    const { value, onSelect, onBack, submitting = false, error } = this.props
    const isStudent = value === 'student'

    return (
      <div className="step-role">
        {error ? <Banner type="danger">{error}</Banner> : null}
        <RoleCard
          icon={<TeacherIcon />}
          title="Docente"
          subtitle="Vas a dar materias"
          selected={value === 'teacher'}
          onClick={() => onSelect('teacher')}
        />
        <RoleCard
          icon={<StudentIcon />}
          title="Alumno"
          subtitle="Queres tener clases"
          selected={isStudent}
          onClick={() => onSelect('student')}
        />
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={onBack} disabled={submitting}>
            Atrás
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value || submitting}
            onClick={this.handleNext}
          >
            {isStudent && submitting ? <SpinnerIcon className="spin" /> : null}
            {isStudent ? 'Registrarme' : 'Siguiente'}
          </button>
        </div>
      </div>
    )
  }
}

export default StepRole

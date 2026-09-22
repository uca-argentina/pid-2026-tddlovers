import { Component } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Navigate } from 'react-router-dom'
import ProgressSteps from '../../components/ProgressSteps.jsx'
import AuthHero from '../../components/AuthHero.jsx'
import StepAccount from './steps/StepAccount.jsx'
import StepRole from './steps/StepRole.jsx'
import StepSubjects from './steps/StepSubjects.jsx'
import { fetchSubjects, registerAccount } from '../../api/client.js'
import './RegisterPage.css'

const STEP_ACCOUNT = 0
const STEP_ROLE = 1
const STEP_SUBJECTS = 2

const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 60 : -60, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -60 : 60, opacity: 0 }),
}

/**
 * Máquina de estados del registro en 3 pasos: cuenta -> rol -> materias.
 * Class component: todo el estado del flujo vive acá (this.state), los
 * pasos son componentes controlados que reciben datos y callbacks por
 * props.
 */
class RegisterPage extends Component {
  state = {
    step: STEP_ACCOUNT,
    direction: 1,
    values: {
      email: '',
      password: '',
      confirmPassword: '',
      nombre: '',
      apellido: '',
      telefono: '',
    },
    touched: {},
    role: null,
    subjects: [],
    subjectsLoading: false,
    subjectsError: null,
    selectedSubjectIds: [],
    submitting: false,
    submitError: null,
    done: false,
  }

  handleValueChange = (field, value) => {
    this.setState((prev) => ({ values: { ...prev.values, [field]: value } }))
  }

  handleFieldBlur = (field) => {
    this.setState((prev) => ({ touched: { ...prev.touched, [field]: true } }))
  }

  goTo = (step, direction) => {
    this.setState({ step, direction })
  }

  handleAccountSubmit = () => {
    this.goTo(STEP_ROLE, 1)
  }

  handleAccountInvalidSubmit = () => {
    this.setState({
      touched: {
        email: true,
        password: true,
        confirmPassword: true,
        nombre: true,
        apellido: true,
        telefono: true,
      },
    })
  }

  handleRoleSelect = (role) => {
    this.setState({ role })
  }

  handleRoleNext = () => {
    // Students don't pick subjects at signup (that's a search/browse-time
    // concept, not a profile field) — only teachers see the subjects step.
    if (this.state.role === 'student') {
      this.handleFinalSubmit()
      return
    }

    this.goTo(STEP_SUBJECTS, 1)
    if (this.state.subjects.length === 0 && !this.state.subjectsLoading) {
      this.loadSubjects()
    }
  }

  handleBackToAccount = () => {
    this.goTo(STEP_ACCOUNT, -1)
  }

  handleBackToRole = () => {
    this.goTo(STEP_ROLE, -1)
  }

  handleBack = () => {
    if (this.state.step === STEP_ROLE) {
      this.handleBackToAccount()
    } else if (this.state.step === STEP_SUBJECTS) {
      this.handleBackToRole()
    }
  }

  loadSubjects = () => {
    this.setState({ subjectsLoading: true, subjectsError: null })
    fetchSubjects()
      .then((subjects) => {
        // Defensivo: si el backend devuelve algo inesperado (no un array),
        // preferimos una lista vacía a romper el render de SubjectPicker.
        this.setState({
          subjects: Array.isArray(subjects) ? subjects : [],
          subjectsLoading: false,
        })
      })
      .catch((error) => {
        this.setState({
          subjectsLoading: false,
          subjectsError: error.message || 'No se pudieron cargar las materias.',
        })
      })
  }

  handleSubjectToggle = (subjectId) => {
    this.setState((prev) => {
      const isSelected = prev.selectedSubjectIds.includes(subjectId)
      return {
        selectedSubjectIds: isSelected
          ? prev.selectedSubjectIds.filter((id) => id !== subjectId)
          : [...prev.selectedSubjectIds, subjectId],
      }
    })
  }

  buildPayload() {
    const { values, role, selectedSubjectIds } = this.state
    return {
      email: values.email,
      password: values.password,
      nombre: values.nombre,
      apellido: values.apellido,
      telefono: values.telefono,
      role,
      subjectIds: selectedSubjectIds,
    }
  }

  handleFinalSubmit = () => {
    this.setState({ submitting: true, submitError: null })
    registerAccount(this.buildPayload())
      .then((result) => {
        // `done` dispara el <Navigate> del render: avisamos para arriba (para
        // el mensaje de bienvenida) y mandamos al login.
        this.setState({ submitting: false, done: true })
        this.props.onComplete?.(result, this.state.values.nombre)
      })
      .catch((error) => {
        this.setState({
          submitting: false,
          submitError: error.message || 'No se pudo completar el registro.',
        })
      })
  }

  renderStep() {
    const { step, values, touched, role, subjects, subjectsLoading, selectedSubjectIds, submitting, submitError } =
      this.state

    if (step === STEP_ACCOUNT) {
      return (
        <StepAccount
          values={values}
          touched={touched}
          onChange={this.handleValueChange}
          onBlur={this.handleFieldBlur}
          onSubmit={this.handleAccountSubmit}
          onInvalidSubmit={this.handleAccountInvalidSubmit}
        />
      )
    }

    if (step === STEP_ROLE) {
      return (
        <StepRole
          value={role}
          onSelect={this.handleRoleSelect}
          onNext={this.handleRoleNext}
          onBack={this.handleBackToAccount}
          submitting={submitting}
          error={submitError}
        />
      )
    }

    return (
      <StepSubjects
        role={role}
        subjects={subjects}
        selectedIds={selectedSubjectIds}
        onToggle={this.handleSubjectToggle}
        onBack={this.handleBackToRole}
        onSubmit={this.handleFinalSubmit}
        loading={subjectsLoading}
        submitting={submitting}
        error={submitError}
      />
    )
  }

  render() {
    const { step, direction, done, role } = this.state
    const canGoBack = step > STEP_ACCOUNT
    // Los alumnos no pasan por el paso de materias: el indicador no debe
    // mostrar un tercer paso que nunca van a ver.
    const totalSteps = role === 'student' ? 2 : 3

    if (done) {
      return <Navigate to="/ingresar" replace />
    }

    return (
      <div className="auth-page">
        <AuthHero showBack={canGoBack} onBack={this.handleBack} />
        <div className="auth-panel">
          <div className="auth-card">
            <h1 className="auth-title">Crear cuenta</h1>
            <ProgressSteps total={totalSteps} current={step} />
            <div className="register-step-viewport">
              <AnimatePresence mode="wait" custom={direction} initial={false}>
                <motion.div
                  key={step}
                  custom={direction}
                  variants={slideVariants}
                  initial="enter"
                  animate="center"
                  exit="exit"
                  transition={{ duration: 0.25, ease: 'easeInOut' }}
                >
                  {this.renderStep()}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </div>
      </div>
    )
  }
}

export default RegisterPage

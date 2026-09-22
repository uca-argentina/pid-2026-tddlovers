import { Component } from 'react'
import { Link, Navigate } from 'react-router-dom'
import AuthHero from '../../components/AuthHero.jsx'
import Banner from '../../components/Banner.jsx'
import FormField from '../../components/FormField.jsx'
import PasswordInput from '../../components/PasswordInput.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { isValidEmail } from '../../utils/validation.js'
import { loginAccount } from '../../api/client.js'

/**
 * Pantalla de login. Class component, mismo patrón visual que
 * RegisterPage (AuthHero + tarjeta blanca), pero sin pasos: un solo
 * formulario con email y contraseña.
 */
class LoginPage extends Component {
  state = {
    values: { email: '', password: '' },
    touched: {},
    submitting: false,
    error: null,
    done: false,
  }

  getEmailError() {
    const email = this.state.values.email || ''
    if (!email) return 'El email es obligatorio.'
    if (!isValidEmail(email)) return 'Ingresá un email válido.'
    return null
  }

  getPasswordError() {
    if (!this.state.values.password) return 'La contraseña es obligatoria.'
    return null
  }

  isValid() {
    return !this.getEmailError() && !this.getPasswordError()
  }

  handleChange = (field) => (event) => {
    const value = event.target.value
    this.setState((prev) => ({ values: { ...prev.values, [field]: value } }))
  }

  handleBlur = (field) => () => {
    this.setState((prev) => ({ touched: { ...prev.touched, [field]: true } }))
  }

  handleSubmit = (event) => {
    event.preventDefault()

    if (!this.isValid()) {
      this.setState({ touched: { email: true, password: true } })
      return
    }

    this.setState({ submitting: true, error: null })
    loginAccount(this.state.values)
      .then((result) => {
        // `done` dispara el <Navigate> del render, igual que en RegisterPage.
        // La redirección vive acá y no en la ruta de App para que /ingresar se
        // pueda visitar aunque ya haya un usuario cargado.
        this.setState({ submitting: false, done: true })
        this.props.onSuccess?.(result)
      })
      .catch((error) => {
        this.setState({
          submitting: false,
          error: error.message || 'No se pudo iniciar sesión.',
        })
      })
  }

  render() {
    const { values, touched, submitting, error, done } = this.state
    const { successMessage } = this.props

    if (done) {
      return <Navigate to="/" replace />
    }

    return (
      <div className="auth-page">
        <div className="auth-shell">
          <AuthHero showBack={false} />
          <div className="auth-card">
            <h1 className="auth-title">Bienvenido</h1>
            {successMessage ? <Banner type="success">{successMessage}</Banner> : null}
            {error ? <Banner type="danger">{error}</Banner> : null}
            <form onSubmit={this.handleSubmit} noValidate>
              <FormField
                label="Email"
                type="email"
                autoComplete="email"
                value={values.email}
                onChange={this.handleChange('email')}
                onBlur={this.handleBlur('email')}
                touched={touched.email}
                error={this.getEmailError()}
              />
              <PasswordInput
                label="Contraseña"
                autoComplete="current-password"
                value={values.password}
                onChange={this.handleChange('password')}
                onBlur={this.handleBlur('password')}
                touched={touched.password}
                error={this.getPasswordError()}
              />
              <div className="btn-row">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={!this.isValid() || submitting}
                >
                  {submitting ? <SpinnerIcon className="spin" /> : null}
                  Iniciar sesión
                </button>
              </div>
            </form>
            <p className="auth-switch">
              ¿No tenés cuenta?{' '}
              <Link className="auth-link" to="/registro">
                Registrate
              </Link>
            </p>
          </div>
        </div>
      </div>
    )
  }
}

export default LoginPage

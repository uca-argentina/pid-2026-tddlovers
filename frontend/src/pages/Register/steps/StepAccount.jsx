import { Component } from 'react'
import { Link } from 'react-router-dom'
import FormField from '../../../components/FormField.jsx'
import PasswordInput from '../../../components/PasswordInput.jsx'
import {
  isNonEmptyName,
  isValidEmail,
  isValidPassword,
  isValidPhone,
} from '../../../utils/validation.js'

/**
 * Paso 1 del registro: email, contraseña (repetida), nombre, apellido y
 * teléfono opcional. El estado de los valores vive en el padre
 * (RegisterPage) — este componente solo sabe validar y renderizar.
 */
class StepAccount extends Component {
  getEmailError() {
    const email = this.props.values.email || ''
    if (!email) return 'El email es obligatorio.'
    if (!isValidEmail(email)) return 'Ingresá un email válido.'
    return null
  }

  getPasswordError() {
    const password = this.props.values.password || ''
    if (!password) return 'La contraseña es obligatoria.'
    if (!isValidPassword(password)) {
      return 'Debe tener al menos 10 caracteres, con mayúsculas, minúsculas, números y un carácter especial.'
    }
    return null
  }

  getConfirmPasswordError() {
    const { password = '', confirmPassword = '' } = this.props.values
    if (!confirmPassword) return 'Repetí la contraseña.'
    if (confirmPassword !== password) return 'Las contraseñas no coinciden.'
    return null
  }

  getNombreError() {
    if (!isNonEmptyName(this.props.values.nombre || '')) return 'Ingresá tu nombre.'
    return null
  }

  getApellidoError() {
    if (!isNonEmptyName(this.props.values.apellido || '')) return 'Ingresá tu apellido.'
    return null
  }

  getTelefonoError() {
    if (!isValidPhone(this.props.values.telefono || '')) return 'Ingresá un teléfono válido.'
    return null
  }

  isValid() {
    return (
      !this.getEmailError() &&
      !this.getPasswordError() &&
      !this.getConfirmPasswordError() &&
      !this.getNombreError() &&
      !this.getApellidoError() &&
      !this.getTelefonoError()
    )
  }

  handleChange = (field) => (event) => {
    this.props.onChange(field, event.target.value)
  }

  handleBlur = (field) => () => {
    this.props.onBlur(field)
  }

  handleSubmit = (event) => {
    event.preventDefault()
    if (this.isValid()) {
      this.props.onSubmit()
    } else {
      this.props.onInvalidSubmit?.()
    }
  }

  render() {
    const { values, touched } = this.props

    return (
      <form className="step-account" onSubmit={this.handleSubmit} noValidate>
        <FormField
          label="Email"
          type="email"
          autoComplete="email"
          value={values.email || ''}
          onChange={this.handleChange('email')}
          onBlur={this.handleBlur('email')}
          touched={touched.email}
          error={this.getEmailError()}
        />
        <PasswordInput
          label="Contraseña"
          autoComplete="new-password"
          value={values.password || ''}
          onChange={this.handleChange('password')}
          onBlur={this.handleBlur('password')}
          touched={touched.password}
          error={this.getPasswordError()}
          hint="Mínimo 10 caracteres, con mayúsculas, minúsculas, números y un carácter especial."
        />
        <PasswordInput
          label="Repetir contraseña"
          autoComplete="new-password"
          value={values.confirmPassword || ''}
          onChange={this.handleChange('confirmPassword')}
          onBlur={this.handleBlur('confirmPassword')}
          touched={touched.confirmPassword}
          error={this.getConfirmPasswordError()}
        />
        <FormField
          label="Nombre"
          autoComplete="given-name"
          value={values.nombre || ''}
          onChange={this.handleChange('nombre')}
          onBlur={this.handleBlur('nombre')}
          touched={touched.nombre}
          error={this.getNombreError()}
        />
        <FormField
          label="Apellido"
          autoComplete="family-name"
          value={values.apellido || ''}
          onChange={this.handleChange('apellido')}
          onBlur={this.handleBlur('apellido')}
          touched={touched.apellido}
          error={this.getApellidoError()}
        />
        <FormField
          label="Teléfono (opcional)"
          type="tel"
          autoComplete="tel"
          value={values.telefono || ''}
          onChange={this.handleChange('telefono')}
          onBlur={this.handleBlur('telefono')}
          touched={touched.telefono}
          error={this.getTelefonoError()}
        />
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={!this.isValid()}>
            Siguiente
          </button>
        </div>
        <p className="auth-switch">
          ¿Ya tenés cuenta?{' '}
          <Link className="auth-link" to="/ingresar">
            Iniciá sesión
          </Link>
        </p>
      </form>
    )
  }
}

StepAccount.defaultProps = {
  values: {},
  touched: {},
}

export default StepAccount

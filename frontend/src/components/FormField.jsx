import { Component } from 'react'
import { CheckIcon, ErrorIcon } from './icons.jsx'
import './FormField.css'

// Class components no tienen `useId`, así que generamos un id único a mano
// con un contador de módulo (el patrón clásico de antes de los hooks).
let nextFieldId = 0

/**
 * Input con feedback visual de validación integrado: neutro mientras no se
 * tocó, verde + check cuando es válido, rojo + mensaje cuando se tocó y es
 * inválido. `rightSlot` deja que quien lo use (p. ej. PasswordInput) ponga
 * un botón donde iría el ícono de estado.
 */
class FormField extends Component {
  constructor(props) {
    super(props)
    this.id = `field-${++nextFieldId}`
  }

  render() {
    const {
      label,
      type = 'text',
      value,
      onChange,
      onBlur,
      touched = false,
      error,
      hint,
      successText,
      rightSlot,
      ...inputProps
    } = this.props

    const showError = touched && Boolean(error)
    const showValid = touched && !error && String(value).trim().length > 0
    const status = showError ? 'field-invalid' : showValid ? 'field-valid' : ''

    return (
      <div className={`field ${status}`}>
        <label className="field-label" htmlFor={this.id}>
          {label}
        </label>
        <div className="field-input-wrap">
          <input
            id={this.id}
            className="field-input"
            type={type}
            value={value}
            onChange={onChange}
            onBlur={onBlur}
            aria-invalid={showError}
            {...inputProps}
          />
          {rightSlot ? (
            rightSlot
          ) : showError ? (
            <ErrorIcon className="field-icon" />
          ) : showValid ? (
            <CheckIcon className="field-icon" />
          ) : null}
        </div>
        {showError ? (
          <span className="field-message" role="alert">
            {error}
          </span>
        ) : showValid && successText ? (
          <span className="field-message">{successText}</span>
        ) : hint ? (
          <span className="field-hint">{hint}</span>
        ) : null}
      </div>
    )
  }
}

export default FormField

import { Component } from 'react'
import { ADDRESS_FIELDS, MAX_LABEL_LENGTH } from '../utils/addresses.js'
import './AddressFields.css'

// Class components no tienen useId: un contador de módulo, igual que FormField.
let nextId = 0

/**
 * Los campos de una dirección (calle, número, CP, localidad, ciudad, piso,
 * depto. y detalle), en grilla. Controlado: `value` es el formulario
 * (utils/addresses.js) y cada cambio sale entero por onChange.
 *
 * Lo usan el perfil (direcciones guardadas) y el formulario de un horario
 * (cargar una dirección nueva ahí mismo). `showLabel` agrega el nombre
 * ("Casa"), que solo hace falta si la dirección se guarda.
 *
 * La localidad lleva la aclaración de que es lo que ven los alumnos antes de
 * pagar: el docente tiene que saber qué expone.
 */
class AddressFields extends Component {
  constructor(props) {
    super(props)
    this.idPrefix = `address-${++nextId}`
  }

  handleField = (key) => (event) => {
    this.props.onChange({ ...this.props.value, [key]: event.target.value })
  }

  renderField({ key, label, max, required, placeholder }) {
    const { value, errors, showErrors, disabled } = this.props
    const id = `${this.idPrefix}-${key}`
    const error = showErrors ? errors[key] : null
    let hint = null
    if (key === 'locality') hint = 'Es lo que ven los alumnos antes de pagar la clase.'

    return (
      <div key={key} className={`address-field is-${key}`}>
        <label className="address-label" htmlFor={id}>
          {label}
          {required ? null : <span className="address-optional"> (opcional)</span>}
        </label>
        <input
          id={id}
          className="address-input"
          type="text"
          value={value[key]}
          maxLength={max}
          placeholder={placeholder}
          onChange={this.handleField(key)}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          aria-describedby={error || hint ? `${id}-help` : undefined}
        />
        {error ? (
          <span className="address-error" id={`${id}-help`} role="alert">
            {error}
          </span>
        ) : null}
        {!error && hint ? (
          <span className="address-hint" id={`${id}-help`}>
            {hint}
          </span>
        ) : null}
      </div>
    )
  }

  render() {
    const { showLabel } = this.props
    const campos = showLabel
      ? [
          {
            key: 'label',
            label: 'Nombre',
            max: MAX_LABEL_LENGTH,
            required: true,
            placeholder: 'Casa, Escuela, Oficina...',
          },
          ...ADDRESS_FIELDS,
        ]
      : ADDRESS_FIELDS
    return <div className="address-fields">{campos.map((field) => this.renderField(field))}</div>
  }
}

AddressFields.defaultProps = {
  errors: {},
  showErrors: false,
  disabled: false,
  showLabel: false,
}

export default AddressFields

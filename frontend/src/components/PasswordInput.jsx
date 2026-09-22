import { Component } from 'react'
import FormField from './FormField.jsx'
import { EyeIcon, EyeOffIcon } from './icons.jsx'

class PasswordInput extends Component {
  state = {
    visible: false,
  }

  toggleVisible = () => {
    this.setState((prev) => ({ visible: !prev.visible }))
  }

  render() {
    const { label, value, onChange, onBlur, touched, error, hint, autoComplete } = this.props
    const { visible } = this.state

    return (
      <FormField
        label={label}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        touched={touched}
        error={error}
        hint={hint}
        autoComplete={autoComplete}
        rightSlot={
          <button
            type="button"
            className="field-icon is-button"
            onClick={this.toggleVisible}
            aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
            tabIndex={-1}
          >
            {visible ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        }
      />
    )
  }
}

export default PasswordInput

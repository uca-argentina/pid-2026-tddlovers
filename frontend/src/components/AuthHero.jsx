import { Component } from 'react'
import { ChevronLeftIcon } from './icons.jsx'

/**
 * Encabezado decorativo compartido por las pantallas de auth (Registro,
 * Login): banda azul con círculos + botón "Volver" opcional. Los estilos
 * viven en styles/ui.css (.auth-hero, .auth-back, .auth-hero-circle*).
 */
class AuthHero extends Component {
  render() {
    const { showBack, onBack } = this.props

    return (
      <div className="auth-hero">
        {showBack ? (
          <button type="button" className="auth-back" onClick={onBack} aria-label="Volver">
            <ChevronLeftIcon />
          </button>
        ) : null}
        <span className="auth-hero-circle auth-hero-circle-a" aria-hidden="true" />
        <span className="auth-hero-circle auth-hero-circle-b" aria-hidden="true" />
        <span className="auth-hero-circle auth-hero-circle-c" aria-hidden="true" />
      </div>
    )
  }
}

AuthHero.defaultProps = {
  showBack: false,
  onBack: undefined,
}

export default AuthHero

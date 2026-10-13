import { Component } from 'react'
import { MoonIcon, SunIcon } from './icons.jsx'
import {
  applyTheme,
  readStoredTheme,
  resolveInitialTheme,
  storeTheme,
  THEME_DARK,
  THEME_LIGHT,
} from '../utils/theme.js'

/**
 * Botón para cambiar entre modo claro y oscuro. El tema es global (un
 * atributo en <html>), pero nadie más necesita saberlo, así que el estado
 * vive acá adentro en vez de subir hasta App.
 *
 * Muestra el ícono de lo que se va a activar al tocarlo: si estamos en claro
 * muestra la luna, y al revés.
 *
 * Con `variant="switch"` es una fila "Modo oscuro" con el interruptor de iOS:
 * así va en el Perfil del teléfono, donde la barra no tiene lugar para el
 * botón de tema.
 */
class ThemeToggle extends Component {
  state = {
    // El tema que se está viendo: el elegido por el usuario o, si nunca
    // eligió, el del sistema.
    theme: resolveInitialTheme(),
  }

  componentDidMount() {
    const stored = readStoredTheme()
    // Solo pisamos el tema si el usuario eligió alguna vez. Mientras no lo
    // haya hecho, <html> se queda sin data-theme y manda el sistema — así
    // la app acompaña si se cambia el modo del sistema con la app abierta.
    if (stored) {
      applyTheme(stored)
    }
  }

  handleToggle = () => {
    const theme = this.state.theme === THEME_DARK ? THEME_LIGHT : THEME_DARK
    applyTheme(theme)
    storeTheme(theme)
    this.setState({ theme })
  }

  render() {
    const esOscuro = this.state.theme === THEME_DARK

    if (this.props.variant === 'switch') {
      return (
        <label className="ios-row ios-switch-row">
          {esOscuro ? <MoonIcon className="ios-row-icon" /> : <SunIcon className="ios-row-icon" />}
          <span className="ios-row-label">Modo oscuro</span>
          <input
            type="checkbox"
            role="switch"
            className="ios-switch"
            checked={esOscuro}
            onChange={this.handleToggle}
          />
        </label>
      )
    }

    return (
      <button
        type="button"
        className="navbar-icon-btn"
        onClick={this.handleToggle}
        aria-label={esOscuro ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
      >
        {esOscuro ? <SunIcon /> : <MoonIcon />}
      </button>
    )
  }
}

ThemeToggle.defaultProps = {
  variant: 'button',
}

export default ThemeToggle

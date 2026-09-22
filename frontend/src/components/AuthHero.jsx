import { Component } from 'react'
import { CalendarIcon, ChevronLeftIcon } from './icons.jsx'

/**
 * Panel de la izquierda de las pantallas de auth (Registro, Login): la
 * marca, una frase corta y una ilustración. Se llama "hero" desde que era
 * una banda azul arriba de la tarjeta; ahora es la columna clara que
 * acompaña al panel oscuro donde vive el formulario.
 *
 * El botón "Volver" sigue acá porque es el registro el que lo necesita (para
 * moverse entre pasos) y el login lo apaga con showBack={false}.
 *
 * La ilustración es un SVG inline y no un archivo: así hereda los colores de
 * la paleta con currentColor/variables y no hay un asset que mantener
 * aparte. Es decorativa, de ahí el aria-hidden.
 *
 * Los estilos viven en styles/ui.css (.auth-hero, .auth-back, .auth-art).
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

        <div className="auth-brand">
          <span className="auth-brand-mark" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="auth-brand-name">BookIt</span>
        </div>

        <p className="auth-tagline">Coordiná tus clases particulares en un solo lugar.</p>

        <svg
          className="auth-art"
          viewBox="0 0 320 320"
          fill="none"
          role="img"
          aria-hidden="true"
        >
          {/* Una persona sentada frente a un escritorio con el calendario de
              la app en pantalla. Las proporciones están pensadas sobre la
              línea del escritorio (y=170): la silla y el cuerpo quedan a la
              izquierda y el monitor apoyado a la derecha. */}
          <ellipse cx="170" cy="192" rx="118" ry="9" className="auth-art-shadow" />

          {/* Monitor */}
          <rect x="132" y="38" width="136" height="94" rx="7" className="auth-art-screen" />
          <rect x="132" y="38" width="136" height="14" rx="7" className="auth-art-screen-bar" />
          <rect x="132" y="45" width="136" height="7" className="auth-art-screen-bar" />

          {/* La grilla del calendario adentro de la pantalla */}
          <g className="auth-art-grid">
            <rect x="143" y="62" width="25" height="15" rx="2.5" />
            <rect x="173" y="62" width="25" height="15" rx="2.5" />
            <rect x="203" y="62" width="25" height="15" rx="2.5" />
            <rect x="233" y="62" width="25" height="15" rx="2.5" />
            <rect x="143" y="82" width="25" height="15" rx="2.5" />
            <rect x="203" y="82" width="25" height="15" rx="2.5" />
            <rect x="233" y="82" width="25" height="15" rx="2.5" />
            <rect x="143" y="102" width="25" height="15" rx="2.5" />
            <rect x="173" y="102" width="25" height="15" rx="2.5" />
            <rect x="233" y="102" width="25" height="15" rx="2.5" />
          </g>
          {/* Dos días reservados, en el azul fuerte */}
          <rect x="173" y="82" width="25" height="15" rx="2.5" className="auth-art-accent" />
          <rect x="203" y="102" width="25" height="15" rx="2.5" className="auth-art-accent" />

          {/* Pie del monitor */}
          <rect x="192" y="132" width="16" height="22" className="auth-art-screen-bar" />
          <rect x="174" y="154" width="52" height="6" rx="3" className="auth-art-screen-bar" />

          {/* Escritorio */}
          <rect x="40" y="166" width="248" height="7" rx="3.5" className="auth-art-desk" />
          <rect x="250" y="173" width="6" height="22" rx="3" className="auth-art-desk" />
          <rect x="66" y="173" width="6" height="22" rx="3" className="auth-art-desk" />

          {/* Persona de perfil, sentada: cabeza, torso inclinado hacia el
              escritorio y el brazo apoyado sobre él. Son tres formas llenas
              y simples — a este tamaño cualquier detalle más se empasta. */}
          <circle cx="82" cy="96" r="14" className="auth-art-accent" />
          {/* Torso: de los hombros a la línea del escritorio. */}
          <path
            d="M64 166v-30a18 18 0 0 1 36 0v30z"
            className="auth-art-accent"
          />
          {/* Brazo estirado hacia el teclado, apoyado en el escritorio. */}
          <path
            d="M96 142h34a4 4 0 0 1 0 8H96z"
            className="auth-art-accent"
          />
          {/* Teclado */}
          <rect x="112" y="158" width="52" height="6" rx="3" className="auth-art-desk" />

          {/* Plantita, para equilibrar la derecha */}
          <path d="M272 166v-16" className="auth-art-line" strokeWidth="2.5" />
          <path
            d="M272 154c-8-1-11-7-10-14 7 0 12 5 10 14zM272 157c7-2 10-8 8-14-7 1-11 7-8 14z"
            className="auth-art-grid-fill"
          />
        </svg>
      </div>
    )
  }
}

AuthHero.defaultProps = {
  showBack: false,
  onBack: undefined,
}

export default AuthHero

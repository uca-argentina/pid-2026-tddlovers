import { Component } from 'react'
import { createPortal } from 'react-dom'
import { ErrorIcon } from './icons.jsx'
import './Modal.css'

/**
 * El primer modal de la app. Hasta acá lo más parecido era CopyDayMenu, que es
 * un globito pegado a su botón y no una capa por encima de todo, así que lo de
 * abajo es todo nuevo y por eso está explicado.
 *
 * Va por createPortal al <body> y no en su lugar del árbol: adentro de la
 * pantalla hay contenedores con overflow:hidden (el visor del calendario) y
 * divs animados por framer-motion, y un transform crea bloque contenedor para
 * los position:fixed — o sea que el modal podría terminar recortado o
 * atrapado. createPortal es una función y no un hook, así que esto sigue
 * siendo un class component como todo lo demás.
 *
 * Lo que hace falta para que un modal sea usable y que la app no tenía:
 *   - z-index por encima de la barra (que está en 10).
 *   - Escape para cerrar, escuchado en el documento.
 *   - el foco entra al abrir y vuelve al botón que lo abrió al cerrar.
 *   - trampa de foco: tabular no se escapa a lo que quedó atrás.
 *   - el fondo no scrollea mientras está abierto.
 */
class Modal extends Component {
  panelRef = null

  previousFocus = null

  componentDidMount() {
    this.previousFocus = document.activeElement

    document.addEventListener('keydown', this.handleKeyDown, true)
    // El scroll del fondo se congela con overflow en el body: si no, rueda lo
    // de atrás mientras el modal se queda quieto.
    this.previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    this.focusFirst()
  }

  componentWillUnmount() {
    document.removeEventListener('keydown', this.handleKeyDown, true)
    document.body.style.overflow = this.previousOverflow || ''
    this.previousFocus?.focus?.()
  }

  setPanelRef = (node) => {
    this.panelRef = node
  }

  getFocusable() {
    if (!this.panelRef) return []
    return [
      ...this.panelRef.querySelectorAll(
        'button:not([disabled]), a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ]
  }

  focusFirst() {
    const focusables = this.getFocusable()
    // Si no hay nada que enfocar, el panel mismo (tiene tabIndex -1): el foco
    // nunca puede quedar en lo de atrás.
    ;(focusables[0] || this.panelRef)?.focus()
  }

  handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      this.props.onClose()
      return
    }

    if (event.key !== 'Tab') return

    // La trampa: en los bordes, Tab da la vuelta en vez de irse afuera.
    const focusables = this.getFocusable()
    if (focusables.length === 0) {
      event.preventDefault()
      return
    }

    const primero = focusables[0]
    const ultimo = focusables[focusables.length - 1]
    const activo = document.activeElement

    if (!this.panelRef.contains(activo)) {
      event.preventDefault()
      primero.focus()
      return
    }
    if (event.shiftKey && activo === primero) {
      event.preventDefault()
      ultimo.focus()
    } else if (!event.shiftKey && activo === ultimo) {
      event.preventDefault()
      primero.focus()
    }
  }

  handleBackdropPointerDown = (event) => {
    // Solo el fondo, no un arrastre que empezó adentro y terminó afuera.
    if (event.target === event.currentTarget) this.props.onClose()
  }

  render() {
    const { title, children, onClose, wide } = this.props

    return createPortal(
      <div className="modal-backdrop" onPointerDown={this.handleBackdropPointerDown}>
        <div
          className={`modal-panel ${wide ? 'is-wide' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={this.setPanelRef}
        >
          <div className="modal-head">
            <h2 className="modal-title">{title}</h2>
            <button type="button" className="modal-close" onClick={onClose} aria-label="Cerrar">
              <ErrorIcon />
            </button>
          </div>
          {children}
        </div>
      </div>,
      document.body,
    )
  }
}

Modal.defaultProps = {
  // `wide` es para lo que se entiende mejor con lugar, como una línea de
  // tiempo. En un teléfono no cambia nada: ahí el panel ya ocupa el ancho de
  // la pantalla.
  wide: false,
}

export default Modal

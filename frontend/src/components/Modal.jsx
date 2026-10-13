import { Component } from 'react'
import { createPortal } from 'react-dom'
import { ErrorIcon } from './icons.jsx'
import { matchesQuery, MOBILE_QUERY } from '../utils/media.js'
import './Modal.css'

// Los modales abiertos, del de más abajo al de más arriba. Se apilan (una
// categoría de reservas → una clase → confirmar la cancelación) y cada uno
// escucha el teclado en el documento: sin esto, un Escape cerraría todos y la
// trampa de foco del de abajo le robaría el foco al de arriba.
const openModals = []

// Cuánto tarda la hoja alta en bajar al cerrarse. Mismo número que la
// transición de .modal-backdrop.is-tall en Modal.css.
const CLOSE_MS = 260

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
 *
 * En el teléfono el CSS lo convierte en una hoja que sube desde abajo, como
 * las de iOS, y se cierra arrastrando la manija (o el título) hacia abajo.
 * El arrastre mueve el panel tocando el style directo, sin setState: son
 * decenas de eventos por segundo y no cambia nada que React tenga que saber.
 */
class Modal extends Component {
  panelRef = null

  previousFocus = null

  // Dónde arrancó el arrastre de la hoja (clientY), o null si no se arrastra.
  dragStart = null

  dragDelta = 0

  componentDidMount() {
    this.previousFocus = document.activeElement
    openModals.push(this)

    document.addEventListener('keydown', this.handleKeyDown, true)
    // El scroll del fondo se congela con overflow en el body: si no, rueda lo
    // de atrás mientras el modal se queda quieto.
    this.previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    this.focusFirst()
  }

  componentWillUnmount() {
    clearTimeout(this.closeTimer)
    const index = openModals.indexOf(this)
    if (index !== -1) openModals.splice(index, 1)
    document.removeEventListener('keydown', this.handleKeyDown, true)
    document.body.style.overflow = this.previousOverflow || ''
    this.previousFocus?.focus?.()
  }

  setPanelRef = (node) => {
    this.panelRef = node
  }

  setBackdropRef = (node) => {
    this.backdropRef = node
  }

  /**
   * Cerrar desde adentro (cruz, Escape, fondo, arrastre). La hoja alta baja
   * antes de irse, como entró: recién cuando terminó de bajar se avisa a
   * quien la abrió, que es el que la desmonta. Se anima con una transición
   * desde donde esté (si se venía arrastrando, sigue desde ahí) y no con
   * keyframes, que arrancarían siempre desde arriba. Los modales comunes, o
   * con movimiento reducido, se cierran al toque.
   */
  requestClose = () => {
    if (this.closing) return
    const panel = this.panelRef
    if (!this.props.tall || !panel || matchesQuery('(prefers-reduced-motion: reduce)')) {
      this.props.onClose()
      return
    }
    this.closing = true
    this.backdropRef?.classList.add('is-closing')
    // Sin la animación de entrada: si todavía corre, le gana a la transición.
    panel.style.animation = 'none'
    panel.style.transition = `transform ${CLOSE_MS}ms cubic-bezier(0.4, 0, 1, 1)`
    panel.style.transform = 'translateY(100%)'
    this.closeTimer = setTimeout(() => this.props.onClose(), CLOSE_MS)
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
    // Solo el de arriba de la pila atiende el teclado.
    if (openModals[openModals.length - 1] !== this) return

    if (event.key === 'Escape') {
      event.stopPropagation()
      this.requestClose()
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

  /** Arrastrar la hoja hacia abajo: solo en el teléfono, desde la manija o el título. */
  handleDragStart = (event) => {
    if (!matchesQuery(MOBILE_QUERY) || !this.panelRef) return
    // El botón de cerrar es un botón, no una manija.
    if (event.target.closest?.('button')) return
    this.dragStart = event.clientY
    this.dragDelta = 0
    this.panelRef.style.transition = 'none'
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }

  handleDragMove = (event) => {
    if (this.dragStart === null) return
    // Hacia arriba no se estira: la hoja ya está entera.
    this.dragDelta = Math.max(event.clientY - this.dragStart, 0)
    this.panelRef.style.transform = `translateY(${this.dragDelta}px)`
  }

  handleDragEnd = () => {
    if (this.dragStart === null) return
    this.dragStart = null
    const panel = this.panelRef
    panel.style.transition = ''
    // Más de 100px (o más de un cuarto de la hoja) cierra; menos, vuelve.
    if (this.dragDelta > Math.min(100, panel.offsetHeight / 4)) {
      this.requestClose()
      return
    }
    panel.style.transform = ''
  }

  handleBackdropPointerDown = (event) => {
    // Solo el fondo, no un arrastre que empezó adentro y terminó afuera.
    if (event.target === event.currentTarget) this.requestClose()
  }

  render() {
    const { title, children, wide, tall } = this.props

    return createPortal(
      <div
        ref={this.setBackdropRef}
        className={`modal-backdrop ${tall ? 'is-tall' : ''}`}
        onPointerDown={this.handleBackdropPointerDown}
      >
        <div
          className={`modal-panel ${wide ? 'is-wide' : ''} ${tall ? 'is-tall' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-label={title}
          tabIndex={-1}
          ref={this.setPanelRef}
        >
          {/* La manija de la hoja: solo se ve en el teléfono. */}
          <div
            className="modal-grabber"
            aria-hidden="true"
            onPointerDown={this.handleDragStart}
            onPointerMove={this.handleDragMove}
            onPointerUp={this.handleDragEnd}
            onPointerCancel={this.handleDragEnd}
          />
          <div
            className="modal-head"
            onPointerDown={this.handleDragStart}
            onPointerMove={this.handleDragMove}
            onPointerUp={this.handleDragEnd}
            onPointerCancel={this.handleDragEnd}
          >
            <h2 className="modal-title">{title}</h2>
            <button
              type="button"
              className="modal-close"
              onClick={this.requestClose}
              aria-label="Cerrar"
            >
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
  // `tall` ocupa casi toda la pantalla, pegado abajo: solo queda arriba una
  // franja con la página desenfocada, para no perder de dónde se vino. Es
  // para listas largas (las reservas de una categoría, el detalle de una
  // clase con su material).
  tall: false,
}

export default Modal

import { Component } from 'react'
import { dayLabel } from '../../utils/availability.js'

/**
 * "Copiar a otros días": checkboxes de los otros seis días y un botón que
 * confirma, en vez de copiar de a un día por clic. El caso real es "el lunes va
 * igual de martes a viernes", y hacerlo de a uno son cinco idas y vueltas.
 *
 * REEMPLAZA lo que haya en el día destino, no lo suma. Es lo que la gente
 * quiere decir con "copiar", y sumar dejaría horarios que nadie pidió — así que
 * se avisa arriba de los checkboxes.
 *
 * Se cierra con Escape (devolviendo el foco al botón que lo abrió) y al tocar
 * afuera. El listener de "afuera" se agrega solo mientras está abierto y se
 * saca al desmontar, igual que el de resize en CalendarPage.
 */
class CopyDayMenu extends Component {
  state = {
    targets: [],
  }

  panelRef = null

  // Quién tenía el foco antes de abrir (el botón que abrió el menú): al
  // cerrar hay que devolvérselo, si no el foco se pierde al principio de la
  // página y quien navega con teclado queda desubicado.
  previousFocus = null

  componentDidMount() {
    this.previousFocus = document.activeElement
    document.addEventListener('pointerdown', this.handleOutsidePointerDown)
    // Escape se escucha en el documento y no en el panel: recién abierto el
    // foco todavía está en el botón de afuera, así que un handler en el panel
    // no se enteraría.
    document.addEventListener('keydown', this.handleDocumentKeyDown)
    this.panelRef?.querySelector('input')?.focus()
  }

  componentWillUnmount() {
    document.removeEventListener('pointerdown', this.handleOutsidePointerDown)
    document.removeEventListener('keydown', this.handleDocumentKeyDown)
    this.previousFocus?.focus?.()
  }

  setPanelRef = (node) => {
    this.panelRef = node
  }

  handleOutsidePointerDown = (event) => {
    if (this.panelRef && !this.panelRef.contains(event.target)) {
      this.props.onClose()
    }
  }

  handleDocumentKeyDown = (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      this.props.onClose()
    }
  }

  handleToggleTarget = (dayKey) => () => {
    this.setState((prev) => ({
      targets: prev.targets.includes(dayKey)
        ? prev.targets.filter((key) => key !== dayKey)
        : [...prev.targets, dayKey],
    }))
  }

  handleCopy = () => {
    this.props.onCopy(this.state.targets)
  }

  render() {
    const { dayKey, otherDays } = this.props
    const { targets } = this.state

    return (
      <div className="sched-copy" ref={this.setPanelRef}>
        <p className="sched-copy-title">Copiar {dayLabel(dayKey)} a:</p>
        <p className="sched-copy-warning">Reemplaza lo que esos días tengan cargado.</p>

        <ul className="sched-copy-list">
          {otherDays.map((otherDay) => (
            <li key={otherDay}>
              <label className="sched-copy-item">
                <input
                  type="checkbox"
                  checked={targets.includes(otherDay)}
                  onChange={this.handleToggleTarget(otherDay)}
                />
                {dayLabel(otherDay)}
              </label>
            </li>
          ))}
        </ul>

        <div className="sched-copy-actions">
          <button type="button" className="btn btn-ghost" onClick={this.props.onClose}>
            Cancelar
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={this.handleCopy}
            disabled={targets.length === 0}
          >
            Copiar
          </button>
        </div>
      </div>
    )
  }
}

CopyDayMenu.defaultProps = {
  otherDays: [],
}

export default CopyDayMenu

import { Component } from 'react'

/**
 * Una celda de media hora. Es la capa de INTERACCIÓN: lo que se ve pintado es
 * el bloque fusionado que va por encima (ver SchedulerDayColumn), pero el área
 * sensible sigue siendo de media hora, que es la unidad del dominio.
 *
 * No recibe NINGÚN handler. Los eventos los escucha la columna por delegación
 * (pointerover burbujea) y saca el día y el índice de los data-*. Sin closures
 * por celda todas las props son escalares, así que shouldComponentUpdate sirve
 * de verdad: en un arrastre se repintan las 2 o 3 celdas que cambiaron, no las
 * 336.
 *
 * Las celdas ocupadas por otra materia van con aria-disabled y NO con disabled:
 * un botón deshabilitado se saltea en la navegación por teclado y en la lista
 * de elementos de los lectores de pantalla, así que el docente nunca se
 * enteraría de POR QUÉ no puede usar ese horario.
 */
class SchedulerCell extends Component {
  shouldComponentUpdate(nextProps) {
    return (
      nextProps.state !== this.props.state ||
      nextProps.invalid !== this.props.invalid ||
      nextProps.pending !== this.props.pending ||
      nextProps.focusable !== this.props.focusable ||
      nextProps.label !== this.props.label
    )
  }

  render() {
    const { dayKey, index, row, state, pending, invalid, label, focusable, isHalf } = this.props

    const classNames = ['sched-cell']
    if (state === 'selected') classNames.push('is-selected')
    if (state === 'blocked') classNames.push('is-blocked')
    if (state === 'removed') classNames.push('is-removed')
    if (pending) classNames.push('is-pending')
    if (invalid) classNames.push('is-invalid')
    if (isHalf) classNames.push('is-half')

    return (
      <button
        type="button"
        className={classNames.join(' ')}
        style={{ gridRow: row }}
        data-day={dayKey}
        data-index={index}
        tabIndex={focusable ? 0 : -1}
        aria-pressed={state === 'selected'}
        aria-disabled={state === 'blocked' ? 'true' : undefined}
        aria-invalid={invalid ? 'true' : undefined}
        aria-label={label}
      />
    )
  }
}

SchedulerCell.defaultProps = {
  state: 'free',
  pending: false,
  invalid: false,
  focusable: false,
  isHalf: false,
}

export default SchedulerCell

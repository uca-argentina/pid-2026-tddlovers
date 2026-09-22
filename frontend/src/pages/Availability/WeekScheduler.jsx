import { Component, createRef } from 'react'
import SchedulerDayColumn from './SchedulerDayColumn.jsx'
import CopyDayMenu from './CopyDayMenu.jsx'
import { CopyIcon } from '../../components/icons.jsx'
import { matchesQuery, watchQuery } from '../../utils/media.js'
import {
  copyDayTo,
  countSlots,
  DAY_KEYS,
  dayLabel,
  formatRangeLabel,
  formatShortRunsStatus,
  formatSlotTotal,
  hourRangeToIndexes,
  parseSlotId,
  sameSlots,
  slotIdAt,
  slotIdsBetween,
  slotIdsToRanges,
} from '../../utils/availability.js'
import { WEEKDAY_LABELS } from '../../utils/calendar.js'
import './WeekScheduler.css'

// Abajo de esto se muestra un día solo: es el mismo punto donde MonthGrid ya
// se rinde con el texto adentro de las celdas.
const NARROW_QUERY = '(max-width: 600px)'

// Alto de una celda de media hora si no se puede medir (jsdom mide todo 0).
const FALLBACK_SLOT_HEIGHT = 14

/**
 * Grilla semanal para pintar disponibilidad: 7 columnas (una por día) por
 * medias horas. Las clases duran 1 h y arrancan en punto o y media (ver
 * CLAUDE.md), así que la unidad es la media hora y dos seguidas son una clase.
 *
 * Es un componente controlado: el Set de slots entra por `value` y sale por
 * `onChange`, que recibe un Set nuevo (nunca se muta el de arriba) y se llama
 * UNA VEZ POR GESTO, al soltar — no una vez por celda: si no, el padre
 * recalcularía todo cuarenta y ocho veces en un arrastre largo.
 *
 * `blockedBySlot` son los horarios que el docente ya ocupó con OTRA materia,
 * mapeados al nombre de esa materia: no se pueden tocar, porque nadie puede dar
 * dos clases a la vez.
 *
 * Sobre el arrastre, que es lo que tiene más filo:
 *   - Se escucha pointerover DELEGADO en cada columna, nunca pointerenter ni
 *     elementFromPoint. pointerover burbujea (un listener por columna, celdas
 *     sin closures) y es lo que realmente dispara user-event al cambiar de
 *     target, que es lo que hace que esto se pueda testear en jsdom.
 *   - Nunca se escucha pointermove: lo único que importa es entrar a una celda
 *     nueva, así que un arrastre de todo el día son ≤48 setState, no cientos.
 *   - En pointerdown hay que SOLTAR la captura implícita del puntero: en touch
 *     el navegador captura el puntero en el elemento donde arrancó, y sin
 *     soltarla los eventos de las otras celdas no llegan nunca. Sin eso el
 *     arrastre pinta una sola celda en el teléfono y anda perfecto en la
 *     compu, que es una falla que pasa las revisiones.
 */
class WeekScheduler extends Component {
  state = {
    dragDay: null,
    dragAnchor: null,
    dragCursor: null,
    dragMode: null,
    focusedId: null,
    copyOpenFor: null,
    activeDay: DAY_KEYS[0],
    isNarrow: false,
    slotHeight: FALLBACK_SLOT_HEIGHT,
    lastTouchedDay: null,
  }

  gridRef = createRef()

  unwatchNarrow = null

  componentDidMount() {
    this.setState({ isNarrow: matchesQuery(NARROW_QUERY) })
    this.unwatchNarrow = watchQuery(NARROW_QUERY, (isNarrow) => this.setState({ isNarrow }))
    this.measureSlotHeight()
    window.addEventListener('resize', this.measureSlotHeight)
  }

  componentWillUnmount() {
    this.stopDragging()
    this.unwatchNarrow?.()
    window.removeEventListener('resize', this.measureSlotHeight)
  }

  /**
   * El alto de una celda vive en el CSS (--sched-slot-h, redefinido por
   * breakpoint) y se lee de vuelta acá para una sola decisión: si un bloque de
   * una sola media hora es demasiado bajo para que entre '14:00 – 14:30', la
   * etiqueta no se dibuja y queda solo en el aria-label. Mismo patrón que
   * CalendarPage con --day-event-line.
   */
  measureSlotHeight = () => {
    const node = this.gridRef.current
    if (!node) return

    const declared = getComputedStyle(node).getPropertyValue('--sched-slot-h')
    const slotHeight = parseFloat(declared)
    if (!slotHeight || slotHeight === this.state.slotHeight) return

    this.setState({ slotHeight })
  }

  getVisibleDays() {
    return this.state.isNarrow ? [this.state.activeDay] : DAY_KEYS
  }

  getIndexes() {
    return hourRangeToIndexes(this.props.startHour, this.props.endHour)
  }

  /**
   * Qué celda lleva el tabIndex 0. Es una sola en toda la grilla (roving
   * tabindex): 336 paradas de tabulación serían inusables. Si todavía no se
   * movió el foco, o si quedó en un día que ahora no se ve (pasó a la vista de
   * un día), vale la primera celda visible — si no, la grilla no se podría
   * alcanzar con el teclado.
   */
  getFocusableId() {
    const { focusedId } = this.state
    const days = this.getVisibleDays()

    if (focusedId) {
      const parsed = parseSlotId(focusedId)
      if (parsed && days.includes(parsed.dayKey)) return focusedId
    }

    return slotIdAt(days[0], this.getIndexes().fromIndex)
  }

  /** El día y el índice de la celda que recibió el evento, si fue una celda. */
  resolveSlot(event) {
    const node = event.target.closest?.('[data-index]')
    if (!node) return null
    return { dayKey: node.dataset.day, index: Number(node.dataset.index) }
  }

  /** Los ids que el arrastre está por tocar, salteando los ocupados. */
  getDraftIds() {
    const { dragDay, dragAnchor, dragCursor } = this.state
    if (dragDay === null) return []

    // Los ocupados se SALTEAN, no cortan el arrastre: pintar de 09:00 a 18:00
    // por arriba de una isla ocupada a las 11:00 tiene que funcionar y dejar
    // la isla como está.
    return slotIdsBetween(dragDay, dragAnchor, dragCursor).filter(
      (id) => !this.props.blockedBySlot[id],
    )
  }

  getEffectiveValue() {
    const { dragMode } = this.state
    const next = new Set(this.props.value)

    for (const id of this.getDraftIds()) {
      if (dragMode === 'add') next.add(id)
      else next.delete(id)
    }

    return next
  }

  getStatusText() {
    const { lastTouchedDay } = this.state
    // Lo que está mal va al final del mismo renglón: role="status" es "polite",
    // y nombrar los tramos es lo único que le dice a quien no ve la grilla CUÁL
    // es el horario que hay que arreglar (el bloque rojo es aria-hidden).
    const cortos = formatShortRunsStatus(this.props.shortRuns)

    let base
    if (lastTouchedDay) {
      const ranges = slotIdsToRanges(this.props.value)[lastTouchedDay]
      const texto = ranges
        ? ranges.map((range) => formatRangeLabel(range.start, range.end)).join(', ')
        : null
      const dia = dayLabel(lastTouchedDay)
      // Con punto final: si no, al pegarle el aviso de los tramos cortos queda
      // "Martes: 05:30 – 06:00 Martes 05:30 – 06:00 dura media hora".
      base = texto ? `${dia}: ${texto}.` : `${dia}: sin horarios.`
    } else {
      base = `${formatSlotTotal(countSlots(this.props.value))} por semana.`
    }

    return cortos ? `${base} ${cortos}` : base
  }

  stopDragging() {
    document.removeEventListener('pointerup', this.handleDocumentPointerUp)
    document.removeEventListener('pointercancel', this.handleDocumentPointerCancel)
    this.setState({ dragDay: null, dragAnchor: null, dragCursor: null, dragMode: null })
  }

  commitSlots(next, dayKey) {
    if (sameSlots(next, this.props.value)) return
    this.setState({ lastTouchedDay: dayKey })
    this.props.onChange(next)
  }

  handlePointerDown = (event) => {
    if (this.props.disabled || !event.isPrimary || event.button > 0) return

    const slot = this.resolveSlot(event)
    if (!slot) return

    const id = slotIdAt(slot.dayKey, slot.index)
    // En un horario ocupado por otra materia no arranca nada.
    if (this.props.blockedBySlot[id]) return

    // Evita que el arrastre seleccione texto o dispare el drag nativo.
    event.preventDefault()

    // Ver el comentario de la clase: sin soltar la captura implícita, en touch
    // el arrastre pinta una sola celda. El guard es porque jsdom no implementa
    // ninguno de los dos métodos.
    const node = event.target
    if (node.hasPointerCapture?.(event.pointerId)) {
      node.releasePointerCapture(event.pointerId)
    }

    this.setState({
      dragDay: slot.dayKey,
      dragAnchor: slot.index,
      dragCursor: slot.index,
      dragMode: this.props.value.has(id) ? 'remove' : 'add',
      focusedId: id,
      copyOpenFor: null,
    })

    // A nivel documento: soltar afuera de la grilla tiene que cerrar el gesto
    // igual, si no queda pintando para siempre.
    document.addEventListener('pointerup', this.handleDocumentPointerUp)
    document.addEventListener('pointercancel', this.handleDocumentPointerCancel)
  }

  handlePointerOver = (event) => {
    if (this.state.dragDay === null) return

    const slot = this.resolveSlot(event)
    // Un arrastre vive adentro de UN día: pasar por otra columna no la toca.
    if (!slot || slot.dayKey !== this.state.dragDay) return
    if (slot.index === this.state.dragCursor) return

    this.setState({ dragCursor: slot.index })
  }

  handleDocumentPointerUp = () => {
    const next = this.getEffectiveValue()
    const dayKey = this.state.dragDay
    this.stopDragging()
    this.commitSlots(next, dayKey)
  }

  handleDocumentPointerCancel = () => {
    // En touch, cancel significa que el navegador se quedó con el gesto (un
    // scroll, una llamada entrante). Confirmar un rango a medio pintar sería
    // una sorpresa, así que se descarta.
    this.stopDragging()
  }

  handleClick = (event) => {
    // detail 0 = activación por teclado o por un lector de pantalla (NVDA y
    // JAWS activan disparando un click sintético, sin eventos de tecla). El
    // clic real del mouse ya lo procesó el gesto de puntero y llega con
    // detail >= 1: si lo atendiéramos acá, contaría dos veces.
    if (event.detail !== 0 || this.props.disabled) return

    const slot = this.resolveSlot(event)
    if (!slot) return

    const id = slotIdAt(slot.dayKey, slot.index)
    if (this.props.blockedBySlot[id]) return

    const next = new Set(this.props.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)

    this.commitSlots(next, slot.dayKey)
  }

  handleKeyDown = (event) => {
    const slot = this.resolveSlot(event)
    if (!slot) return

    const { fromIndex, toIndex } = this.getIndexes()
    const days = this.getVisibleDays()
    const dayPos = days.indexOf(slot.dayKey)

    let nextDay = slot.dayKey
    let nextIndex = slot.index

    switch (event.key) {
      case 'ArrowUp':
        nextIndex = Math.max(fromIndex, slot.index - 1)
        break
      case 'ArrowDown':
        nextIndex = Math.min(toIndex - 1, slot.index + 1)
        break
      case 'ArrowLeft':
        nextDay = days[Math.max(0, dayPos - 1)]
        break
      case 'ArrowRight':
        nextDay = days[Math.min(days.length - 1, dayPos + 1)]
        break
      case 'Home':
        nextIndex = fromIndex
        break
      case 'End':
        nextIndex = toIndex - 1
        break
      case 'PageUp':
        nextIndex = Math.max(fromIndex, slot.index - 4)
        break
      case 'PageDown':
        nextIndex = Math.min(toIndex - 1, slot.index + 4)
        break
      default:
        return
    }

    // Sin esto las flechas scrollean la página además de mover el foco.
    event.preventDefault()

    const nextId = slotIdAt(nextDay, nextIndex)
    this.setState({ focusedId: nextId })

    const node = this.gridRef.current?.querySelector(
      `[data-day="${nextDay}"][data-index="${nextIndex}"]`,
    )
    node?.focus()
  }

  handleSelectDay = (dayKey) => () => {
    this.setState({ activeDay: dayKey, copyOpenFor: null })
  }

  handleToggleCopy = (dayKey) => () => {
    this.setState((prev) => ({ copyOpenFor: prev.copyOpenFor === dayKey ? null : dayKey }))
  }

  handleCloseCopy = () => {
    this.setState({ copyOpenFor: null })
  }

  handleCopy = (fromDay) => (toDays) => {
    const { slotIds, skipped } = copyDayTo(
      this.props.value,
      fromDay,
      toDays,
      this.props.blockedBySlot,
    )

    this.setState({ copyOpenFor: null, lastTouchedDay: fromDay })
    this.props.onCopyResult?.(skipped)
    if (!sameSlots(slotIds, this.props.value)) this.props.onChange(slotIds)
  }

  renderDayHeader(dayKey) {
    const { copyOpenFor } = this.state
    const abierto = copyOpenFor === dayKey

    return (
      <div className="sched-head-cell" key={dayKey}>
        <span className="sched-head-label">
          <span className="sched-head-long">{dayLabel(dayKey)}</span>
          <span className="sched-head-short">{WEEKDAY_LABELS[DAY_KEYS.indexOf(dayKey)]}</span>
        </span>
        <button
          type="button"
          className="sched-copy-btn"
          onClick={this.handleToggleCopy(dayKey)}
          disabled={this.props.disabled}
          aria-haspopup="true"
          aria-expanded={abierto}
          aria-label={`Copiar los horarios de ${dayLabel(dayKey)} a otros días`}
        >
          <CopyIcon />
        </button>
        {abierto ? (
          <CopyDayMenu
            dayKey={dayKey}
            otherDays={DAY_KEYS.filter((key) => key !== dayKey)}
            onCopy={this.handleCopy(dayKey)}
            onClose={this.handleCloseCopy}
          />
        ) : null}
      </div>
    )
  }

  /**
   * La referencia de colores. Los tres primeros están siempre; "se va a
   * borrar" y "menos de 1 h" aparecen SOLO cuando hay alguno en pantalla, para
   * que en el caso normal la leyenda sea corta y no haya que leer estados que
   * no existen.
   */
  renderLegend() {
    const items = [
      { clase: 'is-selected', texto: 'Guardado' },
      { clase: 'is-selected is-pending', texto: 'Sin guardar' },
      { clase: 'is-blocked', texto: 'Otra materia' },
    ]

    if (this.hasRemoved()) items.push({ clase: 'is-removed', texto: 'Se va a borrar' })
    if (this.props.shortRuns.length > 0) {
      items.push({ clase: 'is-selected is-invalid', texto: 'Menos de 1 h' })
    }

    return (
      <ul className="sched-legend">
        {items.map((item) => (
          <li key={item.texto} className="sched-legend-item">
            <span className={`sched-legend-swatch ${item.clase}`} aria-hidden="true" />
            {item.texto}
          </li>
        ))}
      </ul>
    )
  }

  /** ¿Hay algún horario guardado que el docente despintó y todavía no guardó? */
  hasRemoved() {
    for (const id of this.props.savedIds) {
      if (!this.props.value.has(id)) return true
    }
    return false
  }

  renderTabs() {
    const { activeDay } = this.state

    return (
      <div className="sched-tabs" role="tablist" aria-label="Día de la semana">
        {DAY_KEYS.map((dayKey, index) => {
          const activo = dayKey === activeDay
          const tiene = countSlots(this.props.value, dayKey) > 0

          return (
            <button
              key={dayKey}
              type="button"
              role="tab"
              id={`sched-tab-${dayKey}`}
              aria-selected={activo}
              aria-controls="sched-panel"
              tabIndex={activo ? 0 : -1}
              className={`sched-tab ${activo ? 'is-active' : ''} ${tiene ? 'has-slots' : ''}`}
              onClick={this.handleSelectDay(dayKey)}
            >
              {WEEKDAY_LABELS[index]}
            </button>
          )
        })}
      </div>
    )
  }

  render() {
    const { value, blockedBySlot } = this.props
    const { dragDay, dragAnchor, dragCursor, dragMode, isNarrow, slotHeight } = this.state
    const focusableId = this.getFocusableId()

    const { fromIndex, toIndex } = this.getIndexes()
    const days = this.getVisibleDays()
    const columnas = `var(--sched-gutter-w) repeat(${days.length}, minmax(0, 1fr))`

    // Las horas en punto, para la columna de la izquierda.
    const horas = []
    for (let index = fromIndex; index < toIndex; index += 2) {
      horas.push({ index, label: `${String(Math.floor(index / 2)).padStart(2, '0')}:00` })
    }

    return (
      <div className="sched">
        {isNarrow ? this.renderTabs() : null}

        <div className="sched-head" style={{ gridTemplateColumns: columnas }}>
          <span className="sched-head-gutter" aria-hidden="true" />
          {days.map((dayKey) => this.renderDayHeader(dayKey))}
        </div>

        <div
          className="sched-body"
          style={{ gridTemplateColumns: columnas }}
          ref={this.gridRef}
          id="sched-panel"
          role={isNarrow ? 'tabpanel' : 'group'}
          aria-labelledby={isNarrow ? `sched-tab-${this.state.activeDay}` : undefined}
          aria-label={isNarrow ? undefined : 'Horarios en los que das clase'}
        >
          <div className="sched-gutter" aria-hidden="true">
            {horas.map((hora) => (
              <span
                key={hora.index}
                className="sched-gutter-hour"
                style={{ gridRow: `${hora.index - fromIndex + 1} / span 2` }}
              >
                {hora.label}
              </span>
            ))}
          </div>

          {days.map((dayKey) => (
            <SchedulerDayColumn
              key={dayKey}
              dayKey={dayKey}
              fromIndex={fromIndex}
              toIndex={toIndex}
              selectedIds={value}
              blockedBySlot={blockedBySlot}
              savedIds={this.props.savedIds}
              invalidIds={this.props.invalidIds}
              draftDay={dragDay}
              draftFrom={dragAnchor}
              draftTo={dragCursor}
              draftMode={dragMode}
              focusedId={focusableId}
              slotHeight={slotHeight}
              onPointerDown={this.handlePointerDown}
              onPointerOver={this.handlePointerOver}
              onClick={this.handleClick}
              onKeyDown={this.handleKeyDown}
            />
          ))}
        </div>

        {this.renderLegend()}

        <p className="sched-status" role="status">
          {this.getStatusText()}
        </p>
      </div>
    )
  }
}

WeekScheduler.defaultProps = {
  value: new Set(),
  // Lo que ya está guardado. Vacío por defecto: sin nada guardado, todo lo
  // pintado es nuevo, que es lo correcto para un scheduler suelto.
  savedIds: new Set(),
  blockedBySlot: {},
  invalidIds: new Set(),
  shortRuns: [],
  startHour: 0,
  endHour: 24,
  disabled: false,
}

export default WeekScheduler

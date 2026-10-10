import { Component } from 'react'
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, SpinnerIcon } from './icons.jsx'
import { formatDayLong, WEEKDAY_LABELS } from '../utils/calendar.js'
import './WeekStrip.css'

// Cuánto hay que arrastrar el dedo (en px) para que cuente como "pasar de
// semana" y no como un toque torcido.
const SWIPE_THRESHOLD = 50

/**
 * La tira de semana del teléfono, como la del Calendario de iOS: el mes
 * arriba, y abajo los siete días con la inicial, el número (el elegido en un
 * círculo lleno) y un puntito si ese día hay algo. Se pasa de semana con las
 * flechas o deslizando el dedo.
 *
 * La usan el calendario, el tablero de reservar (las dos vía MonthPane) y la
 * semana del docente. No sabe de dónde salen los datos: cada día llega ya
 * armado en `days` ({ iso, date, isToday, marked, muted, tone? }); `tone`
 * por día pisa el de la tira.
 *
 * Con `expandable`, un botón "Mes" cambia los días por `children` (la grilla
 * del mes): mientras está desplegada, las flechas mueven de a un mes. Eso lo
 * decide quien la usa, que es el que sabe qué es "anterior".
 */
class WeekStrip extends Component {
  swipeStart = null

  handlePointerDown = (event) => {
    this.swipeStart = event.clientX
  }

  handlePointerUp = (event) => {
    if (this.swipeStart === null) return
    const delta = event.clientX - this.swipeStart
    this.swipeStart = null
    if (Math.abs(delta) < SWIPE_THRESHOLD) return
    if (delta > 0) this.props.onPrev()
    else this.props.onNext()
  }

  handlePointerCancel = () => {
    this.swipeStart = null
  }

  /** "Viernes 9 de octubre, hay clases". */
  describeDay(day) {
    const partes = [formatDayLong(day.date)]
    if (day.isToday) partes.push('hoy')
    if (day.marked) partes.push(this.props.markedLabel)
    if (day.muted && this.props.mutedLabel) partes.push(this.props.mutedLabel)
    return partes.join(', ')
  }

  renderDays() {
    const { days, selectedIso, tone, onSelect } = this.props
    return (
      <div
        className="week-strip-days"
        role="group"
        aria-label="Días de la semana"
        onPointerDown={this.handlePointerDown}
        onPointerUp={this.handlePointerUp}
        onPointerCancel={this.handlePointerCancel}
      >
        {days.map((day, index) => {
          const elegido = day.iso === selectedIso
          const clases = ['week-strip-day']
          if (elegido) clases.push('is-selected')
          if (day.isToday) clases.push('is-today')
          if (day.muted) clases.push('is-muted')
          return (
            <button
              key={day.iso}
              type="button"
              className={clases.join(' ')}
              aria-pressed={elegido}
              aria-label={this.describeDay(day)}
              onClick={() => onSelect(day.iso)}
            >
              <span className="week-strip-weekday" aria-hidden="true">
                {WEEKDAY_LABELS[index].charAt(0)}
              </span>
              <span className="week-strip-number" aria-hidden="true">
                {day.date.getDate()}
              </span>
              <span
                className={`week-strip-dot ${day.marked ? `is-${day.tone || tone}` : ''}`}
                aria-hidden="true"
              />
            </button>
          )
        })}
      </div>
    )
  }

  render() {
    const {
      title,
      year,
      compact,
      heading: Heading,
      loading,
      expandable,
      expanded,
      prevLabel,
      nextLabel,
      todayDisabled,
      onPrev,
      onNext,
      onToday,
      onToggleExpanded,
      children,
    } = this.props

    return (
      <div className={`week-strip ${expanded ? 'is-expanded' : ''} ${compact ? 'is-compact' : ''}`}>
        <div className="week-strip-head">
          <Heading className="week-strip-title">
            {title}
            {/* El año más chico y en gris, como el Calendario de iOS: así el
                título entra al lado de los botones en un teléfono de 375px. */}
            {year ? (
              <>
                {' '}
                <span className="week-strip-year">{year}</span>
              </>
            ) : null}
            {loading ? <SpinnerIcon className="spin week-strip-spinner" /> : null}
          </Heading>
          <div className="week-strip-actions">
            <button
              type="button"
              className="week-strip-pill"
              onClick={onToday}
              disabled={todayDisabled}
            >
              Hoy
            </button>
            {expandable ? (
              <button
                type="button"
                className="week-strip-pill"
                aria-expanded={expanded}
                onClick={onToggleExpanded}
              >
                Mes
                <ChevronDownIcon className={`week-strip-caret ${expanded ? 'is-open' : ''}`} />
              </button>
            ) : null}
            <button type="button" className="week-strip-arrow" onClick={onPrev} aria-label={prevLabel}>
              <ChevronLeftIcon />
            </button>
            <button type="button" className="week-strip-arrow" onClick={onNext} aria-label={nextLabel}>
              <ChevronRightIcon />
            </button>
          </div>
        </div>
        {expanded ? children : this.renderDays()}
      </div>
    )
  }
}

WeekStrip.defaultProps = {
  heading: 'h2',
  year: null,
  // Título más chico, para cuando la pantalla ya tiene uno grande arriba.
  compact: false,
  loading: false,
  expandable: false,
  expanded: false,
  todayDisabled: false,
  // 'event' = puntito azul (clases propias); 'free' = verde (algo para
  // reservar), los mismos colores que la grilla del mes.
  tone: 'event',
  markedLabel: 'hay clases',
  mutedLabel: null,
  prevLabel: 'Semana anterior',
  nextLabel: 'Semana siguiente',
  onToggleExpanded: () => {},
}

export default WeekStrip

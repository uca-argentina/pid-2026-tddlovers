import { Component } from 'react'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  RepeatIcon,
  SpinnerIcon,
} from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatDayLong, toISODate, WEEKDAY_LABELS } from '../../utils/calendar.js'
import { matchesQuery, watchQuery } from '../../utils/media.js'
import {
  capacityLabel,
  formatPrice,
  formatWeekTitle,
  modalityLabel,
  toMinutes,
  visibleHours,
  weekDates,
  windowsOn,
} from '../../utils/windows.js'
import './WeekCalendar.css'

// Abajo de esto la grilla de 7 columnas no entra: cada día se lee como una
// lista, uno abajo del otro. Mismo corte que el resto de la app.
const NARROW_QUERY = '(max-width: 600px)'

// Alto de una hora en la grilla. Una clase de 30 min queda de 26px: alcanza
// para la materia y la hora en una línea.
const HOUR_HEIGHT = 52

/**
 * La semana del docente, SOLO PARA VER: cada ventana de disponibilidad es un
 * bloque en su día y su horario. Para cargar o cambiar algo se abre el modal
 * del día (tocando el bloque, la cabecera del día o "Agregar clase").
 *
 * Cada semana es distinta: se muestran las ventanas sueltas de esas fechas y
 * las semanales que ya habían arrancado. La cuenta la hace windowsOn.
 *
 * Como no hay ventanas que se pisen en un mismo día (lo valida el backend),
 * los bloques nunca van lado a lado: cada uno ocupa el ancho de su columna.
 */
class WeekCalendar extends Component {
  state = {
    isNarrow: false,
  }

  unwatchNarrow = null

  componentDidMount() {
    this.setState({ isNarrow: matchesQuery(NARROW_QUERY) })
    this.unwatchNarrow = watchQuery(NARROW_QUERY, (isNarrow) => this.setState({ isNarrow }))
  }

  componentWillUnmount() {
    this.unwatchNarrow?.()
  }

  getDays() {
    const { weekStart, windows, today } = this.props
    return weekDates(weekStart).map((date, index) => {
      const iso = toISODate(date)
      return {
        date,
        iso,
        index,
        isToday: iso === today,
        isPast: iso < today,
        windows: windowsOn(windows, iso),
      }
    })
  }

  /** "Matemática, 13:00 a 16:00, presencial, grupal hasta 4, se repite". */
  describeWindow(window) {
    const partes = [
      window.subjectName,
      `${window.start} a ${window.end}`,
      modalityLabel(window.modality).toLowerCase(),
      capacityLabel(window.maxStudents).toLowerCase(),
      formatPrice(window.price).toLowerCase(),
    ]
    if (window.repeatsWeekly) partes.push('se repite todas las semanas')
    return partes.join(', ')
  }

  renderHead() {
    const { weekStart, loading, onPrev, onNext, onToday, showingThisWeek } = this.props

    return (
      <div className="week-cal-head">
        <div className="week-cal-nav">
          <button
            type="button"
            className="week-cal-arrow"
            onClick={onPrev}
            aria-label="Semana anterior"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="week-cal-arrow"
            onClick={onNext}
            aria-label="Semana siguiente"
          >
            <ChevronRightIcon />
          </button>
        </div>
        <h2 className="week-cal-title">{formatWeekTitle(weekStart)}</h2>
        {loading ? <SpinnerIcon className="spin week-cal-spinner" /> : null}
        <button
          type="button"
          className="week-cal-today"
          onClick={onToday}
          disabled={showingThisWeek}
        >
          Hoy
        </button>
      </div>
    )
  }

  renderBlock(day, window, hours) {
    const top = ((toMinutes(window.start) - hours.from * 60) / 60) * HOUR_HEIGHT
    const height = ((toMinutes(window.end) - toMinutes(window.start)) / 60) * HOUR_HEIGHT
    // Una ventana de media hora no tiene lugar para tres renglones: queda la
    // materia y a qué hora arranca, y el resto en el title (y en el modal).
    const compact = height < HOUR_HEIGHT

    return (
      <button
        key={window.id}
        type="button"
        className={`week-cal-block ${compact ? 'is-compact' : ''} ${window.maxStudents > 1 ? 'is-group' : ''}`}
        style={{ top, height }}
        onClick={() => this.props.onOpenWindow(day.iso, window.id)}
        aria-label={this.describeWindow(window)}
        title={compact ? this.describeWindow(window) : undefined}
      >
        <span className="week-cal-block-subject">
          {window.repeatsWeekly ? <RepeatIcon className="week-cal-block-repeat" /> : null}
          {window.subjectName}
        </span>
        <span className="week-cal-block-time">
          {compact ? window.start : formatRangeLabel(window.start, window.end)}
        </span>
        {compact ? null : (
          <span className="week-cal-block-meta">
            {modalityLabel(window.modality)} · {capacityLabel(window.maxStudents)}
          </span>
        )}
      </button>
    )
  }

  renderGrid(days) {
    const hours = visibleHours(this.props.windows)
    const alto = (hours.to - hours.from) * HOUR_HEIGHT
    const marcas = []
    for (let hour = hours.from; hour < hours.to; hour++) marcas.push(hour)

    return (
      <div className="week-cal-grid" style={{ '--hour-height': `${HOUR_HEIGHT}px` }}>
        <div className="week-cal-corner" aria-hidden="true" />
        {days.map((day) => (
          <button
            key={day.iso}
            type="button"
            className={`week-cal-day-head ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''}`}
            onClick={() => this.props.onOpenDay(day.iso)}
            aria-label={`Ver las clases del ${formatDayLong(day.date).toLowerCase()}`}
          >
            <span className="week-cal-weekday">{WEEKDAY_LABELS[day.index]}</span>
            <span className="week-cal-daynum">{day.date.getDate()}</span>
          </button>
        ))}

        <div className="week-cal-gutter" style={{ height: alto }} aria-hidden="true">
          {marcas.map((hour) => (
            <span
              key={hour}
              className="week-cal-hour"
              style={{ top: (hour - hours.from) * HOUR_HEIGHT }}
            >
              {`${String(hour).padStart(2, '0')}:00`}
            </span>
          ))}
        </div>
        {days.map((day) => (
          <div
            key={day.iso}
            className={`week-cal-col ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''}`}
            style={{ height: alto }}
          >
            {day.windows.map((window) => this.renderBlock(day, window, hours))}
          </div>
        ))}
      </div>
    )
  }

  /** En el teléfono: un día abajo del otro, cada ventana como un renglón. */
  renderAgenda(days) {
    return (
      <ol className="week-cal-agenda">
        {days.map((day) => (
          <li
            key={day.iso}
            className={`week-cal-agenda-day ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''}`}
          >
            <button
              type="button"
              className="week-cal-agenda-head"
              onClick={() => this.props.onOpenDay(day.iso)}
              aria-label={`Ver las clases del ${formatDayLong(day.date).toLowerCase()}`}
            >
              <span>{formatDayLong(day.date)}</span>
              {day.isToday ? <span className="week-cal-today-tag">Hoy</span> : null}
            </button>
            {day.windows.length === 0 ? (
              <p className="week-cal-agenda-empty">Sin clases</p>
            ) : (
              <ul className="week-cal-agenda-list">
                {day.windows.map((window) => (
                  <li key={window.id}>
                    <button
                      type="button"
                      className={`week-cal-agenda-item ${window.maxStudents > 1 ? 'is-group' : ''}`}
                      onClick={() => this.props.onOpenWindow(day.iso, window.id)}
                      aria-label={this.describeWindow(window)}
                    >
                      <span className="week-cal-block-time">
                        {formatRangeLabel(window.start, window.end)}
                      </span>
                      <span className="week-cal-block-subject">
                        {window.repeatsWeekly ? (
                          <RepeatIcon className="week-cal-block-repeat" />
                        ) : null}
                        {window.subjectName}
                      </span>
                      <span className="week-cal-block-meta">
                        {modalityLabel(window.modality)} · {capacityLabel(window.maxStudents)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    )
  }

  render() {
    const days = this.getDays()

    return (
      <section className="week-cal" aria-label="Tu semana">
        {this.renderHead()}
        {this.state.isNarrow ? this.renderAgenda(days) : this.renderGrid(days)}
      </section>
    )
  }
}

WeekCalendar.defaultProps = {
  windows: [],
  loading: false,
  showingThisWeek: false,
}

export default WeekCalendar

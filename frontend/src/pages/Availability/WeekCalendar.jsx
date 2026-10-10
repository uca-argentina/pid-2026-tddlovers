import { Component } from 'react'
import WeekStrip from '../../components/WeekStrip.jsx'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PinIcon,
  PlusIcon,
  RepeatIcon,
  SpinnerIcon,
  UsersIcon,
  VideoIcon,
} from '../../components/icons.jsx'
import withViewport from '../../routes/withViewport.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import {
  formatDayLong,
  formatMonthName,
  toISODate,
  WEEKDAY_LABELS,
} from '../../utils/calendar.js'
import { isOnVacation } from '../../utils/vacations.js'
import {
  capacityLabel,
  formatWeekTitle,
  modalityLabel,
  needsAddress,
  toMinutes,
  visibleHours,
  weekDates,
  windowsOn,
} from '../../utils/windows.js'
import './WeekCalendar.css'

// Alto de una hora en la grilla. Una clase de 30 min queda de 26px: alcanza
// para la materia y la hora en una línea.
const HOUR_HEIGHT = 52

/**
 * La semana del docente, SOLO PARA VER: cada ventana de disponibilidad es un
 * bloque en su día y su horario. Para cargar o cambiar algo se abre el modal
 * del día (tocando el bloque, la cabecera del día o "Agregar horario").
 *
 * Cada semana es distinta: se muestran las ventanas sueltas de esas fechas y
 * las semanales que ya habían arrancado. La cuenta la hace windowsOn.
 *
 * Los días de vacaciones se ven en gris con un cartel: los horarios siguen
 * (vuelven solos cuando terminan), pero nadie los puede reservar.
 *
 * Como no hay ventanas que se pisen en un mismo día (lo valida el backend),
 * los bloques nunca van lado a lado: cada uno ocupa el ancho de su columna.
 *
 * En el teléfono (`mobile`) la grilla de siete columnas no entra: va la misma
 * tira de semana del calendario y, abajo, los horarios del día elegido como
 * tarjetas. Al pasar de semana se queda el mismo día de la semana.
 */
class WeekCalendar extends Component {
  state = {
    // Solo en el teléfono: qué día de la semana (0 = lunes) está elegido.
    // null = hoy si se ve esta semana, si no el lunes.
    selectedIndex: null,
  }

  getDays() {
    const { weekStart, windows, today, vacations } = this.props
    return weekDates(weekStart).map((date, index) => {
      const iso = toISODate(date)
      return {
        date,
        iso,
        index,
        isToday: iso === today,
        isPast: iso < today,
        onVacation: isOnVacation(vacations, iso),
        windows: windowsOn(windows, iso),
      }
    })
  }

  /** "13:00 a 16:00, presencial, grupal · hasta 4, se repite todas las semanas". */
  describeWindow(window, day = null) {
    const partes = [
      `${window.start} a ${window.end}`,
      modalityLabel(window.modality).toLowerCase(),
      capacityLabel(window.maxStudents).toLowerCase(),
    ]
    if (window.repeatsWeekly) partes.push('se repite todas las semanas')
    if (day?.onVacation) partes.push('de vacaciones, no se puede reservar')
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
    // modalidad y a qué hora arranca, y el resto en el title (y en el modal).
    const compact = height < HOUR_HEIGHT

    return (
      <button
        key={window.id}
        type="button"
        className={`week-cal-block ${compact ? 'is-compact' : ''} ${window.maxStudents > 1 ? 'is-group' : ''} ${day.onVacation ? 'is-vacation' : ''}`}
        style={{ top, height }}
        onClick={() => this.props.onOpenWindow(day.iso, window.id)}
        aria-label={this.describeWindow(window, day)}
        title={compact || day.onVacation ? this.describeWindow(window, day) : undefined}
      >
        <span className="week-cal-block-subject">
          {window.repeatsWeekly ? <RepeatIcon className="week-cal-block-repeat" /> : null}
          {modalityLabel(window.modality)}
        </span>
        <span className="week-cal-block-time">
          {compact ? window.start : formatRangeLabel(window.start, window.end)}
        </span>
        {compact ? null : (
          <span className="week-cal-block-meta">{capacityLabel(window.maxStudents)}</span>
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
            className={`week-cal-day-head ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''} ${day.onVacation ? 'is-vacation' : ''}`}
            onClick={() => this.props.onOpenDay(day.iso)}
            aria-label={`Ver los horarios del ${formatDayLong(day.date).toLowerCase()}${day.onVacation ? ', de vacaciones' : ''}`}
          >
            <span className="week-cal-weekday">{WEEKDAY_LABELS[day.index]}</span>
            <span className="week-cal-daynum">{day.date.getDate()}</span>
            {day.onVacation ? <span className="week-cal-vacation-tag">Vacaciones</span> : null}
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
            className={`week-cal-col ${day.isToday ? 'is-today' : ''} ${day.isPast ? 'is-past' : ''} ${day.onVacation ? 'is-vacation' : ''}`}
            style={{ height: alto }}
          >
            {day.windows.map((window) => this.renderBlock(day, window, hours))}
          </div>
        ))}
      </div>
    )
  }

  getSelectedIndex(days) {
    if (this.state.selectedIndex !== null) return this.state.selectedIndex
    const hoy = days.findIndex((day) => day.isToday)
    return hoy >= 0 ? hoy : 0
  }

  handleSelectDay = (iso) => {
    const index = this.getDays().findIndex((day) => day.iso === iso)
    if (index >= 0) this.setState({ selectedIndex: index })
  }

  handleToday = () => {
    this.setState({ selectedIndex: null })
    this.props.onToday()
  }

  /** Un horario del día, con el mismo lenguaje que las tarjetas de reservar. */
  renderWindowCard(day, window) {
    const grupal = window.maxStudents > 1
    const Icono = window.modality === 'in_person' ? PinIcon : VideoIcon
    return (
      <li key={window.id}>
        <button
          type="button"
          className={`week-cal-window ${day.onVacation ? 'is-vacation' : ''}`}
          onClick={() => this.props.onOpenWindow(day.iso, window.id)}
          aria-label={this.describeWindow(window, day)}
        >
          <span className="week-cal-window-head">
            <span className="week-cal-window-time">{formatRangeLabel(window.start, window.end)}</span>
            <span className={`week-cal-window-kind ${grupal ? 'is-group' : ''}`}>
              <UsersIcon />
              {capacityLabel(window.maxStudents)}
            </span>
          </span>
          <span className="week-cal-window-fact">
            <Icono />
            {modalityLabel(window.modality)}
            {needsAddress(window.modality) && window.locality ? ` · ${window.locality}` : ''}
          </span>
          {window.repeatsWeekly ? (
            <span className="week-cal-window-fact">
              <RepeatIcon />
              Se repite todas las semanas
            </span>
          ) : null}
        </button>
      </li>
    )
  }

  renderMobile(days) {
    const { loading, showingThisWeek, onPrev, onNext, onOpenDay } = this.props
    const index = this.getSelectedIndex(days)
    const day = days[index]

    return (
      <section className="week-cal is-mobile" aria-label="Tu semana">
        <WeekStrip
          title={formatMonthName(day.date)}
          year={day.date.getFullYear()}
          compact
          loading={loading}
          days={days.map((item) => ({
            iso: item.iso,
            date: item.date,
            isToday: item.isToday,
            marked: item.windows.length > 0,
            muted: item.onVacation,
          }))}
          selectedIso={day.iso}
          markedLabel="hay horarios"
          mutedLabel="de vacaciones"
          todayDisabled={showingThisWeek && day.isToday}
          onSelect={this.handleSelectDay}
          onPrev={onPrev}
          onNext={onNext}
          onToday={this.handleToday}
        />

        <div className={`week-cal-day ${day.isPast ? 'is-past' : ''}`}>
          <div className="week-cal-day-title">
            <h3>{formatDayLong(day.date)}</h3>
            {day.onVacation ? <span className="week-cal-vacation-tag">Vacaciones</span> : null}
          </div>
          {day.windows.length === 0 ? (
            <p className="week-cal-day-empty">No tenés horarios este día.</p>
          ) : (
            <ul className="week-cal-windows">
              {day.windows.map((window) => this.renderWindowCard(day, window))}
            </ul>
          )}
          <button
            type="button"
            className="week-cal-day-open"
            onClick={() => onOpenDay(day.iso)}
            aria-label={`Ver o agregar horarios del ${formatDayLong(day.date).toLowerCase()}`}
          >
            <PlusIcon />
            Agregar o cambiar horarios de este día
          </button>
        </div>
      </section>
    )
  }

  render() {
    const days = this.getDays()
    if (this.props.mobile) return this.renderMobile(days)

    return (
      <section className="week-cal" aria-label="Tu semana">
        {this.renderHead()}
        {this.renderGrid(days)}
      </section>
    )
  }
}

WeekCalendar.defaultProps = {
  windows: [],
  vacations: [],
  loading: false,
  showingThisWeek: false,
  mobile: false,
}

export default withViewport(WeekCalendar)

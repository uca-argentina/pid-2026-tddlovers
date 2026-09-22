import { Component } from 'react'
import { ErrorIcon } from '../../components/icons.jsx'
import {
  DAY_KEYS,
  DAY_LABELS,
  slotIndexToTime,
  SLOTS_PER_DAY,
  timeToSlotIndex,
} from '../../utils/availability.js'
import { WEEKDAY_LABELS } from '../../utils/calendar.js'
import './BookingFilters.css'

// Las 48 medias horas del día, que es exactamente lo que ofrecen los dos
// selects. No hay concepto nuevo: es slotIndexToTime sobre SLOTS_PER_DAY.
const HORAS = Array.from({ length: SLOTS_PER_DAY }, (_, index) => slotIndexToTime(index))

/**
 * La barra de filtros: días, materias y las dos horas. Todo se combina con Y,
 * y también con lo que se haya buscado en la barra de arriba.
 *
 * Los dos selects son "Desde" y "Hasta" y los dos son opcionales, porque así
 * salen los tres casos con un solo control: solo Desde es "que arranque
 * después de", solo Hasta es "que arranque antes de", y los dos juntos es
 * "entre". Son los primeros <select> de la app: para 48 opciones dan teclado,
 * búsqueda al tipear y la rueda nativa del teléfono gratis, mientras que una
 * lista propia necesitaría una capa flotante y una trampa de foco que la app
 * todavía no tiene.
 */
class BookingFilters extends Component {
  /** Desde después de Hasta no se corrige solo: se avisa y no da resultados. */
  isRangeBackwards() {
    const { fromTime, toTime } = this.props
    if (!fromTime || !toTime) return false
    return timeToSlotIndex(fromTime) > timeToSlotIndex(toTime)
  }

  renderDays() {
    const { dayKeys, onToggleDay } = this.props

    return (
      <div className="booking-filter">
        <span className="booking-filter-label" id="filtro-dias">
          Días
        </span>
        <div className="booking-filter-chips" role="group" aria-labelledby="filtro-dias">
          {DAY_KEYS.map((dayKey, index) => {
            const activo = dayKeys.includes(dayKey)
            return (
              <button
                key={dayKey}
                type="button"
                className={`subject-chip ${activo ? 'selected' : ''}`}
                aria-pressed={activo}
                aria-label={DAY_LABELS[index]}
                onClick={onToggleDay(dayKey)}
              >
                {WEEKDAY_LABELS[index]}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  renderSubjects() {
    const { subjects, subjectIds, onToggleSubject } = this.props
    if (subjects.length === 0) return null

    return (
      <div className="booking-filter">
        <span className="booking-filter-label" id="filtro-materias">
          Materias
        </span>
        <div className="booking-filter-chips" role="group" aria-labelledby="filtro-materias">
          {subjects.map((subject) => {
            // String() de los dos lados: el id puede venir de la URL (siempre
            // string) o del catálogo, así que no se comparan con ===.
            const activo = subjectIds.some((id) => String(id) === String(subject.id))
            return (
              <button
                key={subject.id}
                type="button"
                className={`subject-chip ${activo ? 'selected' : ''}`}
                aria-pressed={activo}
                onClick={onToggleSubject(subject.id)}
              >
                {subject.name}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  renderHours() {
    const { fromTime, toTime, onChangeTime } = this.props

    return (
      <div className="booking-filter">
        <span className="booking-filter-label">Horario</span>
        <div className="booking-filter-times">
          <label className="booking-filter-time">
            <span>Desde</span>
            <select value={fromTime} onChange={onChangeTime('fromTime')}>
              <option value="">Cualquiera</option>
              {HORAS.map((hora) => (
                <option key={hora} value={hora}>
                  {hora}
                </option>
              ))}
            </select>
          </label>

          <label className="booking-filter-time">
            <span>Hasta</span>
            <select value={toTime} onChange={onChangeTime('toTime')}>
              <option value="">Cualquiera</option>
              {HORAS.map((hora) => (
                <option key={hora} value={hora}>
                  {hora}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    )
  }

  render() {
    const { teacherQuery, onClearTeacher, onClear, hasFilters } = this.props

    return (
      <div className="booking-filters">
        {this.renderDays()}
        {this.renderSubjects()}
        {this.renderHours()}

        <div className="booking-filters-foot">
          {teacherQuery ? (
            <button
              type="button"
              className="subject-chip selected"
              onClick={onClearTeacher}
              aria-label="Quitar el filtro por docente"
            >
              <ErrorIcon />
              Docente: {teacherQuery}
            </button>
          ) : null}

          {hasFilters ? (
            <button type="button" className="btn btn-ghost booking-filters-clear" onClick={onClear}>
              Limpiar filtros
            </button>
          ) : null}
        </div>

        {this.isRangeBackwards() ? (
          <p className="booking-filters-hint">Elegí una hora de fin posterior a la de inicio.</p>
        ) : null}
      </div>
    )
  }
}

BookingFilters.defaultProps = {
  subjects: [],
  dayKeys: [],
  subjectIds: [],
  fromTime: '',
  toTime: '',
  teacherQuery: '',
  hasFilters: false,
}

export default BookingFilters

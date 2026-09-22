import { Component } from 'react'
import { ChevronRightIcon, ErrorIcon } from '../../components/icons.jsx'
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
 * El panel de filtros: días, materias y las dos horas. Todo se combina con Y,
 * y también con lo que se haya buscado en la barra de arriba.
 *
 * Vive en la columna angosta al lado del calendario, así que cada grupo es una
 * sección que se puede plegar: los tres abiertos a la vez no entran sin
 * empujar los horarios del día fuera de la pantalla. Arrancan cerrados salvo
 * los que ya traigan algo elegido (por ejemplo al entrar buscando una
 * materia), para que nunca haya un filtro activo escondido.
 *
 * El contenido de una sección cerrada se renderiza igual y se esconde con
 * `hidden`: el estado de los filtros no depende de si la sección está abierta,
 * y así plegar no borra lo elegido.
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
  // Qué secciones están abiertas. Se decide una sola vez, al montar, a partir
  // de lo que venga elegido; después manda el usuario.
  state = {
    abiertas: {
      dias: this.props.dayKeys.length > 0,
      materias: this.props.subjectIds.length > 0,
      horario: Boolean(this.props.fromTime || this.props.toTime),
    },
  }

  /**
   * Las materias llegan por fetch, después de montar: si el alumno entró
   * buscando una materia, la sección tiene que abrirse cuando ese filtro
   * aparece. Solo abre, nunca cierra — si no, plegarla a mano no duraría
   * nada.
   */
  componentDidUpdate(prevProps) {
    const seEligioMateria =
      prevProps.subjectIds.length === 0 && this.props.subjectIds.length > 0
    if (seEligioMateria && !this.state.abiertas.materias) {
      this.setState((prev) => ({ abiertas: { ...prev.abiertas, materias: true } }))
    }
  }

  /** Desde después de Hasta no se corrige solo: se avisa y no da resultados. */
  isRangeBackwards() {
    const { fromTime, toTime } = this.props
    if (!fromTime || !toTime) return false
    return timeToSlotIndex(fromTime) > timeToSlotIndex(toTime)
  }

  handleToggleSection = (key) => () => {
    this.setState((prev) => ({
      abiertas: { ...prev.abiertas, [key]: !prev.abiertas[key] },
    }))
  }

  /**
   * Una sección plegable. `count` es cuántos filtros tiene elegidos: se
   * muestra al lado del título para que se note lo que hay adentro aunque
   * esté cerrada.
   */
  renderSection(key, title, count, children) {
    const abierta = this.state.abiertas[key]
    const panelId = `booking-filter-panel-${key}`

    return (
      <div className="booking-filter">
        <button
          type="button"
          className="booking-filter-head"
          aria-expanded={abierta}
          aria-controls={panelId}
          onClick={this.handleToggleSection(key)}
        >
          <ChevronRightIcon className={`booking-filter-caret ${abierta ? 'is-open' : ''}`} />
          <span className="booking-filter-label">{title}</span>
          {count > 0 ? <span className="booking-filter-count">{count}</span> : null}
        </button>
        {/* Siempre en el DOM: `hidden` lo saca de la vista y del foco sin
            desmontarlo, así plegar no toca lo que está elegido. */}
        <div id={panelId} className="booking-filter-body" hidden={!abierta}>
          {children}
        </div>
      </div>
    )
  }

  renderDays() {
    const { dayKeys, onToggleDay } = this.props

    return this.renderSection(
      'dias',
      'Días',
      dayKeys.length,
      <div className="booking-filter-chips" role="group" aria-label="Días">
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
      </div>,
    )
  }

  renderSubjects() {
    const { subjects, subjectIds, onToggleSubject } = this.props
    if (subjects.length === 0) return null

    return this.renderSection(
      'materias',
      'Materias',
      subjectIds.length,
      <div className="booking-filter-chips" role="group" aria-label="Materias">
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
      </div>,
    )
  }

  renderHours() {
    const { fromTime, toTime, onChangeTime } = this.props
    // Cuenta como UN filtro aunque estén las dos horas: es un solo rango.
    const activos = fromTime || toTime ? 1 : 0

    return this.renderSection(
      'horario',
      'Horario',
      activos,
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
      </div>,
    )
  }

  render() {
    const { teacherQuery, onClearTeacher, onClear, hasFilters } = this.props

    return (
      <div className="booking-filters">
        <h2 className="booking-filters-title">Filtros</h2>

        {this.renderDays()}
        {this.renderSubjects()}
        {this.renderHours()}

        {/* El docente buscado no es una sección: viene de la barra de la
            izquierda y lo único que se puede hacer acá es sacarlo. */}
        {teacherQuery ? (
          <div className="booking-filters-foot">
            <button
              type="button"
              className="subject-chip selected"
              onClick={onClearTeacher}
              aria-label="Quitar el filtro por docente"
            >
              <ErrorIcon />
              Docente: {teacherQuery}
            </button>
          </div>
        ) : null}

        {this.isRangeBackwards() ? (
          <p className="booking-filters-hint">Elegí una hora de fin posterior a la de inicio.</p>
        ) : null}

        {hasFilters ? (
          <button type="button" className="btn btn-ghost booking-filters-clear" onClick={onClear}>
            Limpiar filtros
          </button>
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

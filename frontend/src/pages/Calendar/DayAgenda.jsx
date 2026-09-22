import { Component } from 'react'
import { SpinnerIcon } from '../../components/icons.jsx'
import { formatDayLong, formatDuration } from '../../utils/calendar.js'
import './DayAgenda.css'

/**
 * Panel del día seleccionado: las clases de ese día con más detalle que en
 * la grilla (hora de inicio, cuánto dura, materia y con quién). Las ordena
 * CalendarPage por hora, de la más temprana a la más tarde.
 *
 * Quién es "el otro" depende de desde dónde se mire: un alumno ve el nombre
 * del docente y un docente ve el del alumno. Sin fetch propio: los datos
 * bajan por props.
 *
 * Acá solo llegan clases reservadas (CalendarPage filtra por status), así que
 * ya no se muestra la pastillita de estado: diría "reservada" en el 100% de
 * las filas. El campo `status` sigue viviendo en el dato para la pantalla de
 * disponibilidad.
 */
class DayAgenda extends Component {
  /** El nombre de la contraparte, según desde qué rol se esté mirando. */
  getCounterpart(item) {
    if (this.props.viewRole === 'teacher') {
      return {
        label: 'Alumno',
        // Defensivo: acá solo llegan clases reservadas, así que siempre
        // debería haber alumno. Si el backend manda una sin nombre, preferimos
        // este texto antes que un "Alumno: undefined".
        name: item.studentName || 'Sin reservar',
        empty: !item.studentName,
      }
    }
    return { label: 'Docente', name: item.teacherName, empty: false }
  }

  renderItem(item) {
    const counterpart = this.getCounterpart(item)

    return (
      <li key={item.id} className="day-agenda-item">
        <div className="day-agenda-head">
          <span className="day-agenda-time">{item.startTime}</span>
          <span className="day-agenda-duration">{formatDuration(item.startTime, item.endTime)}</span>
        </div>
        <p className="day-agenda-subject">{item.subjectName}</p>
        <p className={`day-agenda-person ${counterpart.empty ? 'is-empty' : ''}`}>
          <span className="day-agenda-person-label">{counterpart.label}:</span> {counterpart.name}
        </p>
      </li>
    )
  }

  render() {
    const { date, classes, loading } = this.props

    return (
      <section className="day-agenda">
        <h2 className="day-agenda-title">{formatDayLong(date)}</h2>
        <p className="day-agenda-count">
          {classes.length} {classes.length === 1 ? 'clase' : 'clases'}
        </p>

        {loading ? (
          <p className="day-agenda-empty">
            <SpinnerIcon className="spin" />
            Cargando clases...
          </p>
        ) : null}
        {!loading && classes.length === 0 ? (
          <p className="day-agenda-empty">No hay clases este día.</p>
        ) : null}
        {!loading && classes.length > 0 ? (
          <ul className="day-agenda-list">{classes.map((item) => this.renderItem(item))}</ul>
        ) : null}
      </section>
    )
  }
}

DayAgenda.defaultProps = {
  classes: [],
  loading: false,
  viewRole: 'student',
}

export default DayAgenda

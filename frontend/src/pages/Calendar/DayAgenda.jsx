import { Component } from 'react'
import { PinIcon, SpinnerIcon, UsersIcon, VideoIcon } from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatDayLong, formatDuration } from '../../utils/calendar.js'
import {
  capacityLabel,
  formatPrice,
  modalityLabel,
  needsAddress,
  needsMeetingUrl,
} from '../../utils/windows.js'
import './DayAgenda.css'

/**
 * Panel del día seleccionado: las clases de ese día con todo lo que hace
 * falta para ir a darlas o a tomarlas — horario, materia, con quién, cupo,
 * dónde (el link o la dirección exacta, que el alumno recién ve acá, después
 * de reservar) y precio. Las ordena CalendarPage por hora.
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
    const alumnos = (item.students || []).filter(Boolean)
    if (this.props.viewRole === 'teacher' && item.maxStudents > 1 && alumnos.length > 0) {
      // Una grupal: todos los anotados y cuánto lugar queda, aunque por ahora
      // haya uno solo.
      return {
        label: `Alumnos (${alumnos.length} de ${item.maxStudents})`,
        name: alumnos.join(', '),
        empty: false,
      }
    }
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

  /**
   * El cupo. Para el alumno, en una grupal, cuántos van a estar (el número,
   * no quiénes). El docente ya ve los nombres en la línea de alumnos.
   */
  renderCapacity(item) {
    if (!item.maxStudents) return null
    const grupal = item.maxStudents > 1
    const anotados =
      grupal && this.props.viewRole !== 'teacher' && item.enrolled
        ? ` · ${item.enrolled} de ${item.maxStudents} anotados`
        : ''

    return (
      <li>
        <UsersIcon />
        <span>
          {capacityLabel(item.maxStudents)}
          {anotados}
        </span>
      </li>
    )
  }

  /**
   * Dónde es la clase: el link para entrar y/o la dirección exacta con su
   * localidad abajo. Las clases de antes de que existiera la modalidad no
   * tienen nada de esto, y ahí no se muestra.
   */
  renderPlace(item) {
    const link = needsMeetingUrl(item.modality) && item.meetingUrl
    const direccion = needsAddress(item.modality) && item.address

    return (
      <>
        {link ? (
          <li>
            <VideoIcon />
            <a href={item.meetingUrl} target="_blank" rel="noreferrer">
              Entrar a la videollamada
            </a>
          </li>
        ) : null}
        {direccion ? (
          <li className="day-agenda-address">
            <PinIcon />
            <span>
              {item.address}
              {item.locality ? (
                <span className="day-agenda-locality">{item.locality}</span>
              ) : null}
            </span>
          </li>
        ) : null}
      </>
    )
  }

  renderItem(item) {
    const counterpart = this.getCounterpart(item)
    // Nulo en las clases de antes de que existiera el precio.
    const tienePrecio = item.price !== null && item.price !== undefined

    return (
      <li key={item.id} className="day-agenda-item">
        <div className="day-agenda-head">
          <span className="day-agenda-time">{formatRangeLabel(item.startTime, item.endTime)}</span>
          <span className="day-agenda-duration">{formatDuration(item.startTime, item.endTime)}</span>
          {item.modality ? (
            <span className="day-agenda-modality">{modalityLabel(item.modality)}</span>
          ) : null}
        </div>
        <p className="day-agenda-subject">{item.subjectName}</p>
        <p className={`day-agenda-person ${counterpart.empty ? 'is-empty' : ''}`}>
          <span className="day-agenda-person-label">{counterpart.label}:</span> {counterpart.name}
        </p>

        {/* Reservada antes de que las clases tuvieran modalidad, cupo, precio y
            ubicación: esos datos no existen y no hay de dónde sacarlos (la
            ventana de origen ya no está). Se dice, en vez de mostrar una
            tarjeta a medias sin explicación. */}
        {item.modality ? (
          <ul className="day-agenda-facts">
            {this.renderCapacity(item)}
            {this.renderPlace(item)}
          </ul>
        ) : (
          <p className="day-agenda-legacy">
            Reservada antes de que las clases tuvieran modalidad, lugar y precio. Consultalos con{' '}
            {this.props.viewRole === 'teacher' ? 'el alumno' : 'el docente'}.
          </p>
        )}

        {tienePrecio ? <p className="day-agenda-price">{formatPrice(item.price)}</p> : null}
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

import { Component } from 'react'
import ClassActions from '../../components/ClassActions.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { ClockIcon, PinIcon, SpinnerIcon, UsersIcon, VideoIcon } from '../../components/icons.jsx'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatDayLong, formatDuration } from '../../utils/calendar.js'
import { isFavorite } from '../../utils/favorites.js'
import { formatMoney } from '../../utils/rates.js'
import {
  capacityLabel,
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
 * Acá llega todo lo que no está cancelado (CalendarPage lo filtra), así que
 * cada clase muestra su estado y lo que se puede hacer con ella (aceptar,
 * pagar, tomar lista...) con ClassActions. En una grupal el docente ve a cada
 * alumno con su propia reserva: acepta y toma lista de a uno.
 */
class DayAgenda extends Component {
  /**
   * Con quién es la clase, según desde qué rol se mire: el alumno ve al
   * docente y el docente a sus alumnos (en una grupal, todos los anotados).
   * `empty` = una reserva sin nombre de alumno, que no debería pasar.
   */
  getCounterpart(item) {
    if (this.props.viewRole !== 'teacher') return { name: item.teacherName, empty: false }
    const alumnos = (item.students || []).filter(Boolean)
    if (item.maxStudents > 1 && alumnos.length > 0) {
      return { name: alumnos.join(', '), empty: false }
    }
    // Defensivo: toda reserva tiene alumno. Si el backend manda una sin
    // nombre, preferimos este texto antes que un "con undefined".
    return { name: item.studentName || 'Sin reservar', empty: !item.studentName }
  }

  /**
   * La pastilla de arriba a la derecha, como en las tarjetas de Reservar. En
   * una grupal dice cuántos van: el alumno no ve quiénes, el docente sí (en
   * la línea de abajo).
   */
  getCapacity(item) {
    if (item.maxStudents <= 1) return capacityLabel(item.maxStudents)
    const anotados =
      this.props.viewRole === 'teacher'
        ? (item.students || []).filter(Boolean).length
        : item.enrolled
    return anotados
      ? `Grupal · ${anotados} de ${item.maxStudents}`
      : capacityLabel(item.maxStudents)
  }

  /**
   * Dónde es la clase, un renglón por lugar: la videollamada con su link y/o
   * la dirección exacta con la localidad abajo (el alumno recién la ve acá,
   * después de reservar). La modalidad va adelante del primero.
   */
  renderPlace(item) {
    const link = needsMeetingUrl(item.modality) && item.meetingUrl
    const direccion = needsAddress(item.modality) && item.address
    const modalidad = <span className="day-agenda-modality">{modalityLabel(item.modality)}</span>

    // Sin link ni dirección (no debería pasar) queda al menos la modalidad.
    if (!link && !direccion) {
      const Icono = item.modality === 'in_person' ? PinIcon : VideoIcon
      return (
        <li>
          <Icono />
          {modalidad}
        </li>
      )
    }

    return (
      <>
        {link ? (
          <li>
            <VideoIcon />
            <span>
              {modalidad}
              {' · '}
              <a href={item.meetingUrl} target="_blank" rel="noreferrer">
                Entrar a la videollamada
              </a>
            </span>
          </li>
        ) : null}
        {direccion ? (
          <li className="day-agenda-address">
            <PinIcon />
            <span>
              {/* En una híbrida la modalidad ya la dijo el renglón del link. */}
              {link ? null : (
                <>
                  {modalidad}
                  {' · '}
                </>
              )}
              <span className="day-agenda-address-text">{item.address}</span>
              {item.locality ? (
                <span className="day-agenda-locality">{item.locality}</span>
              ) : null}
            </span>
          </li>
        ) : null}
      </>
    )
  }

  /**
   * El estado y los botones. Una grupal vista por el docente tiene una
   * reserva por alumno, cada una con su nombre; en todo lo demás hay una
   * sola.
   */
  renderActions(item) {
    const { viewRole, onClassChange } = this.props
    const rows = item.rows && item.rows.length > 0 ? item.rows : [item]
    const porAlumno = viewRole === 'teacher' && rows.length > 1

    return rows.map((row) => (
      <ClassActions
        key={row.id}
        cls={row}
        viewRole={viewRole}
        label={porAlumno ? row.studentName : null}
        onChange={onClassChange}
      />
    ))
  }

  /** El corazón del docente, solo para el alumno (favoriteIds null = no hay). */
  renderFavorite(item) {
    const { viewRole, favoriteIds, onFavoriteChange, onFavoriteError } = this.props
    if (viewRole !== 'student' || !favoriteIds) return null
    return (
      <FavoriteButton
        teacherId={item.teacherId}
        teacherName={item.teacherName}
        favorite={isFavorite(favoriteIds, item.teacherId)}
        onChange={onFavoriteChange}
        onError={onFavoriteError}
      />
    )
  }

  /**
   * Una clase, con el mismo lenguaje que las tarjetas de Reservar: la
   * materia manda, abajo con quién, después los datos con su ícono y el
   * precio al pie. El horario va en azul (el color de las clases propias en
   * el calendario) y no en el verde de "libre" de Reservar.
   */
  renderItem(item) {
    const counterpart = this.getCounterpart(item)
    const grupal = item.maxStudents > 1

    return (
      <li key={item.id} className="day-agenda-item">
        <div className="day-agenda-head">
          <span className="day-agenda-subject">{item.subjectName}</span>
          <span className={`day-agenda-kind ${grupal ? 'is-group' : ''}`}>
            <UsersIcon />
            {this.getCapacity(item)}
          </span>
        </div>
        <div className="day-agenda-person-row">
          <p className={`day-agenda-person ${counterpart.empty ? 'is-empty' : ''}`}>
            {counterpart.empty ? null : 'con '}
            <span className="day-agenda-person-name">{counterpart.name}</span>
          </p>
          {this.renderFavorite(item)}
        </div>

        <ul className="day-agenda-facts">
          <li>
            <ClockIcon />
            <span>
              <span className="day-agenda-time">
                {formatRangeLabel(item.startTime, item.endTime)}
              </span>
              {' · '}
              <span className="day-agenda-duration">
                {formatDuration(item.startTime, item.endTime)}
              </span>
            </span>
          </li>
          {this.renderPlace(item)}
        </ul>

        {/* En centavos, calculado al reservar (tarifa × duración). */}
        <p className="day-agenda-price">{formatMoney(item.priceCents)}</p>
        {this.renderActions(item)}
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
  favoriteIds: null,
  onClassChange: () => {},
  onFavoriteChange: () => {},
  onFavoriteError: () => {},
}

export default DayAgenda

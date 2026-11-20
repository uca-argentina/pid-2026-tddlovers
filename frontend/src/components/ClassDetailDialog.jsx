import { Component } from 'react'
import BookingActions from './BookingActions.jsx'
import ClassMaterial from './ClassMaterial.jsx'
import Modal from './Modal.jsx'
import AttendanceDialog from './AttendanceDialog.jsx'
import StudentsDialog from './StudentsDialog.jsx'
import ClassActions from './ClassActions.jsx'
import { ClockIcon, ListCheckIcon, PinIcon, UsersIcon, VideoIcon } from './icons.jsx'
import { formatRangeLabel } from '../utils/availability.js'
import { formatDayLongWithYear, formatDuration, fromISODate } from '../utils/calendar.js'
import { canHaveMaterial } from '../utils/classMaterials.js'
import { allowedActions, hasStarted, nowParts, paymentStatus } from '../utils/bookingStates.js'
import { formatMoney } from '../utils/rates.js'
import {
  activeRows,
  classCapacityLabel,
  classPriceLabel,
  classRows,
} from '../utils/reservations.js'
import { modalityLabel, needsAddress, needsMeetingUrl } from '../utils/windows.js'
import { rewardLabel } from '../utils/neuronas.js'
import './ClassDetailDialog.css'

/**
 * El detalle de una clase, en una hoja alta. Es donde se hace lo que no
 * entra en una tarjeta: ver a los alumnos y decidir sobre cada uno (aceptar
 * a uno, rechazar a otro), tomar lista (en su propio modal) y el material de
 * la clase. También repite los botones de la clase entera, para no tener que
 * volver a la lista.
 *
 * Lo usan Mis reservas y la agenda del Calendario. `bookings` son las
 * reservas que tiene cargadas la pantalla: de ahí salen los otros alumnos del
 * clase, que en una grupal el docente ve como filas separadas.
 *
 * Props:
 *   - cls: la reserva que representa a la clase (una fila de GET /api/bookings).
 *   - bookings: ReservationsPage pasa todas sus reservas (classRows saca las del
 *     clase); DayAgenda pasa directamente `rows` de la clase.
 *   - viewRole: 'teacher' | 'student'.
 *   - now: inyectable para tests (ReservationsPage lo reenvía; DayAgenda no).
 *   - onChange(reservaActualizada): el padre reemplaza esa fila.
 *   - onMaterialChange(cls, hasMaterial): solo lo pasa ReservationsPage.
 *   - onClose().
 *
 * Sin fetch propio: las acciones las hacen BookingActions / ClassActions /
 * StudentsDialog / AttendanceDialog, y el material ClassMaterial.
 *
 * Estado: takingAttendance (AttendanceDialog abierto) y managingStudents
 * (StudentsDialog abierto).
 */
class ClassDetailDialog extends Component {
  state = { takingAttendance: false, managingStudents: false }

  handleMaterialChange = (hasMaterial) => {
    this.props.onMaterialChange(this.props.cls, hasMaterial)
  }

  handleOpenAttendance = () => this.setState({ takingAttendance: true })

  handleCloseAttendance = () => this.setState({ takingAttendance: false })

  handleOpenStudents = () => this.setState({ managingStudents: true })

  handleCloseStudents = () => this.setState({ managingStudents: false })

  now() {
    return this.props.now || nowParts()
  }

  /**
   * FILTRO: las reservas de la clase. El docente ve todas las de la clase (una
   * por alumno, las canceladas al final); el alumno, solo la suya (regla del
   * backend: GET /api/bookings no le manda las de otros alumnos).
   */
  getRows() {
    const { cls, bookings, viewRole } = this.props
    if (viewRole !== 'teacher') return [cls]
    const rows = classRows(cls, bookings)
    return rows.length > 0 ? rows : [cls]
  }

  renderPlace() {
    const { cls } = this.props
    const link = needsMeetingUrl(cls.modality) && cls.meetingUrl
    const direccion = needsAddress(cls.modality) && cls.address
    return (
      <>
        <li>
          {cls.modality === 'in_person' ? <PinIcon /> : <VideoIcon />}
          <span>
            {modalityLabel(cls.modality)}
            {link ? (
              <>
                {' · '}
                <a href={cls.meetingUrl} target="_blank" rel="noreferrer">
                  Entrar a la videollamada
                </a>
              </>
            ) : null}
          </span>
        </li>
        {direccion ? (
          <li>
            <PinIcon />
            <span>
              {cls.address}
              {/* La dirección armada (formatAddress) ya trae la localidad,
                  pero en las clases reservadas antes de la migración 019 no
                  está garantizado: por eso se agrega si falta. Esta rama es
                  necesaria, no es código muerto. */}
              {cls.locality && !cls.address.includes(cls.locality) ? (
                <span className="class-detail-muted"> · {cls.locality}</span>
              ) : null}
            </span>
          </li>
        ) : null}
        {/* El alumno ve la dirección exacta recién cuando pagó (el backend
            no la manda antes): hasta entonces, la localidad y por qué. */}
        {needsAddress(cls.modality) && !cls.address ? (
          <li>
            <PinIcon />
            <span>
              {cls.locality || 'Presencial'}
              <span className="class-detail-muted">
                {' · '}
                {cls.status === 'cancelada'
                  ? 'La clase se canceló.'
                  : 'La dirección exacta aparece cuando pagues la clase.'}
              </span>
            </span>
          </li>
        ) : null}
      </>
    )
  }

  renderKind(rows) {
    const { cls, viewRole } = this.props
    const persona = viewRole === 'teacher' ? '' : `Con ${cls.teacherName} · `
    return `${persona}${classCapacityLabel(cls, rows, viewRole)}`
  }

  /** El alumno: el estado de su reserva y sus botones (pagar, reprogramar, cancelar). */
  renderStudentStatus() {
    const { cls, onChange } = this.props
    return (
      <section className="class-detail-section">
        <h3 className="class-detail-section-title">Estado</h3>
        <BookingActions booking={cls} viewRole="student" now={this.props.now} onChange={onChange} />
      </section>
    )
  }

  /**
   * El docente: los botones de la clase entera (aceptar a todos, cancelarla)
   * y, hasta que empieza, los alumnos. En una grupal los alumnos van en su
   * propio modal (decidir de a uno, ver quién pagó), como tomar lista, para
   * no llenar el detalle; en una individual alcanza con el nombre y el pago.
   * Cuando la clase empezó esto desaparece y queda tomar lista.
   */
  renderTeacherStatus(rows) {
    const { cls, onChange } = this.props
    const grupal = cls.maxStudents > 1
    const empezo = hasStarted(cls, this.now())
    const active = activeRows(rows)
    // FILTRO: los alumnos (grupal: botón "Ver alumnos"; individual: nombre y
    // pago) solo antes de que empiece y si queda alguien en pie; después
    // queda tomar lista. Regla de pantalla.

    return (
      <>
        <section className="class-detail-section">
          <h3 className="class-detail-section-title">Clase</h3>
          <ClassActions rows={rows} now={this.props.now} onChange={onChange} />
        </section>
        {!empezo && active.length > 0 && grupal ? this.renderStudentsButton(rows, active) : null}
        {!empezo && active.length > 0 && !grupal ? this.renderSingleStudent(active[0]) : null}
      </>
    )
  }

  renderStudentsButton(rows, active) {
    const pagaron = active.filter((row) => row.paidAt).length
    return (
      <section className="class-detail-section">
        <h3 className="class-detail-section-title">Alumnos</h3>
        <div className="class-detail-attendance">
          <p className="class-detail-hint">
            {active.length} {active.length === 1 ? 'anotado' : 'anotados'} · {pagaron}{' '}
            {pagaron === 1 ? 'pagó' : 'pagaron'}
          </p>
          <button type="button" className="class-action is-secondary" onClick={this.handleOpenStudents}>
            <UsersIcon />
            Ver alumnos
          </button>
        </div>
        {this.state.managingStudents ? (
          <StudentsDialog
            rows={rows}
            now={this.props.now}
            onClose={this.handleCloseStudents}
            onChange={this.props.onChange}
          />
        ) : null}
      </section>
    )
  }

  renderSingleStudent(row) {
    const pago = paymentStatus(row)
    return (
      <section className="class-detail-section">
        <h3 className="class-detail-section-title">Alumno</h3>
        <div className="class-actions-status">
          <span className="class-actions-label">{row.studentName || 'Sin nombre'}</span>
          <span className={`class-status is-${pago.tone}`}>{pago.label}</span>
        </div>
      </section>
    )
  }

  /**
   * FILTRO: "Tomar asistencia", solo si ya empezó y hay a quién tomarle lista
   * (allowedActions 'attend', espejo de checkAction en
   * backend/src/lib/bookingStates.js, que es el que decide).
   */
  renderAttendance(rows) {
    const now = this.now()
    const lista = rows.filter((row) => allowedActions(row, 'teacher', now).includes('attend'))
    if (lista.length === 0) return null

    const presentes = lista.filter((row) => row.status === 'realizada').length
    const ausentes = lista.filter((row) => row.status === 'no_presentada').length
    const sinMarca = lista.length - presentes - ausentes
    let resumen = 'Todavía no tomaste lista.'
    if (sinMarca === 0) {
      resumen = `${presentes} ${presentes === 1 ? 'presente' : 'presentes'} · ${ausentes} ${
        ausentes === 1 ? 'ausente' : 'ausentes'
      }.`
    }
    else if (sinMarca < lista.length) resumen = `Faltan marcar ${sinMarca} de ${lista.length}.`

    return (
      <section className="class-detail-section">
        <h3 className="class-detail-section-title">Asistencia</h3>
        <div className="class-detail-attendance">
          <p className="class-detail-hint">{resumen}</p>
          <button
            type="button"
            className="class-action is-primary"
            onClick={this.handleOpenAttendance}
          >
            <ListCheckIcon />
            Tomar asistencia
          </button>
        </div>
        {this.state.takingAttendance ? (
          <AttendanceDialog
            rows={lista}
            onClose={this.handleCloseAttendance}
            onChange={this.props.onChange}
          />
        ) : null}
      </section>
    )
  }

  /**
   * El precio de una reserva: lo que paga, y si usa paquete o neuronas. Es
   * lo que ve el alumno, y el docente en una individual.
   */
  renderPrice() {
    const { cls } = this.props
    return (
      <p className="class-detail-price">
        {formatMoney(cls.priceCents)}
        {cls.packTokens > 0 ? (
          <span className="class-detail-muted">
            {' · '}
            {cls.packTokens === 1 ? '1 clase' : `${cls.packTokens} clases`} del paquete
          </span>
        ) : null}
        {cls.rewardType ? (
          <span className="class-detail-muted">
            {' · '}
            {rewardLabel(cls.rewardType)} con neuronas
          </span>
        ) : null}
      </p>
    )
  }

  /**
   * El docente en una grupal: cada alumno paga lo suyo (con paquete, con
   * neuronas o entero), así que va el monto o el rango, sin el paquete ni el
   * canje de uno solo. El de cada uno está en "Ver alumnos".
   */
  renderGroupPrice(rows) {
    return <p className="class-detail-price">{classPriceLabel(rows)} por alumno</p>
  }

  render() {
    const { cls, viewRole, onClose } = this.props
    const rows = this.getRows()
    const active = activeRows(rows)
    const docente = viewRole === 'teacher'

    return (
      <Modal title={cls.subjectName} onClose={onClose} tall>
        <div className="class-detail">
          <ul className="class-detail-facts">
            <li>
              <ClockIcon />
              <span>
                <strong>{formatDayLongWithYear(fromISODate(cls.date))}</strong>
                {' · '}
                {formatRangeLabel(cls.startTime, cls.endTime)}
                <span className="class-detail-muted">
                  {' · '}
                  {formatDuration(cls.startTime, cls.endTime)}
                </span>
              </span>
            </li>
            {this.renderPlace()}
            <li>
              <UsersIcon />
              <span>{this.renderKind(rows)}</span>
            </li>
          </ul>
          {docente && cls.maxStudents > 1 ? this.renderGroupPrice(rows) : this.renderPrice()}

          {docente ? this.renderTeacherStatus(rows) : this.renderStudentStatus()}
          {docente ? this.renderAttendance(active) : null}

          {/* FILTRO: el material solo si la clase pudo tenerlo (canHaveMaterial,
              espejo de backend/src/lib/classMaterials.js). */}
          {canHaveMaterial(cls) ? (
            <ClassMaterial
              key={cls.id}
              cls={cls}
              viewRole={viewRole}
              now={this.props.now}
              onChange={this.handleMaterialChange}
            />
          ) : null}
        </div>
      </Modal>
    )
  }
}

ClassDetailDialog.defaultProps = {
  viewRole: 'student',
  bookings: [],
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
  onMaterialChange: () => {},
}

export default ClassDetailDialog

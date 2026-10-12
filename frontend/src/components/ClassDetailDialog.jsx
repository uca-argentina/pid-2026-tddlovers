import { Component } from 'react'
import ClassActions from './ClassActions.jsx'
import ClassMaterial from './ClassMaterial.jsx'
import Modal from './Modal.jsx'
import AttendanceDialog from './AttendanceDialog.jsx'
import StudentsDialog from './StudentsDialog.jsx'
import TurnActions from './TurnActions.jsx'
import { ClockIcon, ListCheckIcon, PinIcon, UsersIcon, VideoIcon } from './icons.jsx'
import { formatRangeLabel } from '../utils/availability.js'
import { formatDayLongWithYear, formatDuration, fromISODate } from '../utils/calendar.js'
import { canHaveMaterial } from '../utils/classMaterials.js'
import { allowedActions, hasStarted, nowParts, paymentStatus } from '../utils/classStates.js'
import { formatMoney } from '../utils/rates.js'
import { turnRows } from '../utils/reservations.js'
import { capacityLabel, modalityLabel, needsAddress, needsMeetingUrl } from '../utils/windows.js'
import './ClassDetailDialog.css'

/**
 * El detalle de una clase, en una hoja alta. Es donde se hace lo que no
 * entra en una tarjeta: ver a los alumnos y decidir sobre cada uno (aceptar
 * a uno, rechazar a otro), tomar lista (en su propio modal) y el material de
 * la clase. También repite los botones de la clase entera, para no tener que
 * volver a la lista.
 *
 * Lo usan Mis reservas y la agenda del Calendario. `classes` son las
 * reservas que tiene cargadas la pantalla: de ahí salen los otros alumnos del
 * turno, que en una grupal el docente ve como filas separadas.
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
   * Las reservas de la clase. El docente ve todas las del turno (una por
   * alumno, las canceladas al final); el alumno, solo la suya.
   */
  getRows() {
    const { cls, classes, viewRole } = this.props
    if (viewRole !== 'teacher') return [cls]
    const rows = turnRows(cls, classes)
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
              {cls.locality ? <span className="class-detail-muted"> · {cls.locality}</span> : null}
            </span>
          </li>
        ) : null}
      </>
    )
  }

  renderKind(active) {
    const { cls, viewRole } = this.props
    const persona = viewRole === 'teacher' ? '' : `Con ${cls.teacherName} · `
    if (cls.maxStudents <= 1) return `${persona}${capacityLabel(cls.maxStudents)}`
    const anotados = viewRole === 'teacher' ? active.length : cls.enrolled
    return `${persona}Grupal · ${anotados} de ${cls.maxStudents}`
  }

  /** El alumno: el estado de su reserva y sus botones (pagar, reprogramar, cancelar). */
  renderStudentStatus() {
    const { cls, onChange } = this.props
    return (
      <section className="class-detail-section">
        <h3 className="class-detail-section-title">Estado</h3>
        <ClassActions cls={cls} viewRole="student" now={this.props.now} onChange={onChange} />
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
    const active = rows.filter((row) => row.status !== 'cancelada')

    return (
      <>
        <section className="class-detail-section">
          <h3 className="class-detail-section-title">Clase</h3>
          <TurnActions rows={rows} now={this.props.now} onChange={onChange} />
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

  /** "Tomar asistencia", solo si ya empezó y hay a quién tomarle lista. */
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

  render() {
    const { cls, viewRole, onClose } = this.props
    const rows = this.getRows()
    const active = rows.filter((row) => row.status !== 'cancelada')
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
              <span>{this.renderKind(active)}</span>
            </li>
          </ul>
          <p className="class-detail-price">
            {formatMoney(cls.priceCents)}
            {docente && cls.maxStudents > 1 ? ' por alumno' : ''}
            {cls.packTokens > 0 ? (
              <span className="class-detail-muted">
                {' · '}
                {cls.packTokens === 1 ? '1 clase' : `${cls.packTokens} clases`} del paquete
              </span>
            ) : null}
          </p>

          {docente ? this.renderTeacherStatus(rows) : this.renderStudentStatus()}
          {docente ? this.renderAttendance(active) : null}

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
  classes: [],
  // Inyectable para los tests; en la app es la hora real.
  now: null,
  onChange: () => {},
  onMaterialChange: () => {},
}

export default ClassDetailDialog

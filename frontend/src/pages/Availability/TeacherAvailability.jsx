import { Component } from 'react'
import { Link } from 'react-router-dom'
import WeekCalendar from './WeekCalendar.jsx'
import DayWindowsDialog from './DayWindowsDialog.jsx'
import Banner from '../../components/Banner.jsx'
import { PlusIcon } from '../../components/icons.jsx'
import { fetchMyWindows, fetchSubjects } from '../../api/client.js'
import { addDays, fromISODate, toISODate } from '../../utils/calendar.js'
import { startOfWeek } from '../../utils/windows.js'

/**
 * La disponibilidad del docente: la semana como calendario de solo lectura y,
 * encima, el modal de un día para cargar o cambiar clases.
 *
 * Cada semana es distinta, así que se pide semana por semana: el backend
 * devuelve las ventanas que caen en ella (las sueltas de esas fechas y las
 * semanales que ya arrancaron), sin expandir, y WeekCalendar las ubica.
 *
 * El modal no tiene datos propios: muestra lo que haya acá y, después de
 * cada cambio, pide que se recargue la semana. Si con las flechas del modal
 * se pasa a otra semana, la de atrás la sigue — el calendario y el modal
 * siempre hablan de la misma.
 */
class TeacherAvailability extends Component {
  state = {
    weekStart: startOfWeek(new Date()),
    windows: [],
    loading: true,
    error: null,
    catalog: [],
    // null con el modal cerrado; si no, { iso, focusId, key }.
    dialog: null,
  }

  // Mismo patrón que CalendarPage: descarta respuestas que llegaron tarde.
  fetchToken = 0

  // Cuántas veces se abrió el modal: es su `key` (ver render).
  dialogCount = 0

  componentDidMount() {
    this.loadWeek(this.state.weekStart)
    fetchSubjects()
      .then((catalog) => this.setState({ catalog: Array.isArray(catalog) ? catalog : [] }))
      .catch(() => {
        // Sin catálogo no hay nombres para el select, pero la semana se sigue
        // viendo: las ventanas ya traen el nombre de su materia.
      })
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  getToday() {
    return toISODate(new Date())
  }

  /** Las materias del perfil, con nombre, para el formulario. */
  getSubjects() {
    const ids = (this.props.user?.subjectIds || []).map(String)
    return this.state.catalog.filter((subject) => ids.includes(String(subject.id)))
  }

  /**
   * Devuelve una promesa que NUNCA falla: el modal la espera para decir
   * "guardado", y si lo que falló es la recarga, lo que se guardó está bien
   * guardado — el error de la recarga se muestra en la página.
   */
  loadWeek = (weekStart) => {
    const token = ++this.fetchToken
    this.setState({ loading: true, error: null })

    return fetchMyWindows({ from: toISODate(weekStart), to: toISODate(addDays(weekStart, 6)) })
      .then((windows) => {
        if (token !== this.fetchToken) return
        this.setState({ windows: Array.isArray(windows) ? windows : [], loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudo cargar tu disponibilidad.',
        })
      })
  }

  goToWeek(weekStart) {
    this.setState({ weekStart, windows: [] })
    this.loadWeek(weekStart)
  }

  handlePrevWeek = () => {
    this.goToWeek(addDays(this.state.weekStart, -7))
  }

  handleNextWeek = () => {
    this.goToWeek(addDays(this.state.weekStart, 7))
  }

  handleThisWeek = () => {
    this.goToWeek(startOfWeek(new Date()))
  }

  isThisWeek() {
    return toISODate(this.state.weekStart) === toISODate(startOfWeek(new Date()))
  }

  /**
   * "Agregar clase" arriba de todo: abre el modal en HOY, con las clases que
   * ya hay ese día, y el formulario se abre recién con el "Agregar clase" de
   * adentro. Si se estaba mirando otra semana, la de atrás vuelve a la de hoy.
   */
  handleAdd = () => {
    this.openDialog(this.getToday())
  }

  handleOpenDay = (iso) => {
    this.openDialog(iso)
  }

  handleOpenWindow = (iso, focusId) => {
    this.openDialog(iso, { focusId })
  }

  openDialog(iso, { focusId = null } = {}) {
    this.followDay(iso)
    this.dialogCount += 1
    this.setState({ dialog: { iso, focusId, key: this.dialogCount } })
  }

  /** Si el día quedó en otra semana, la de atrás se mueve con él. */
  followDay(iso) {
    const weekStart = startOfWeek(fromISODate(iso))
    if (toISODate(weekStart) !== toISODate(this.state.weekStart)) this.goToWeek(weekStart)
  }

  handleChangeDay = (iso) => {
    this.followDay(iso)
    this.setState((prev) => ({ dialog: { ...prev.dialog, iso, focusId: null } }))
  }

  handleCloseDialog = () => {
    this.setState({ dialog: null })
  }

  handleChanged = () => this.loadWeek(this.state.weekStart)

  render() {
    const { weekStart, windows, loading, error, dialog } = this.state
    const subjects = this.getSubjects()
    const sinMaterias = (this.props.user?.subjectIds || []).length === 0

    return (
      <div className="teacher-availability">
        <div className="availability-editor-head">
          <div>
            <h1 className="availability-title">Disponibilidad</h1>
            <p className="availability-hint">
              Las clases que ofrecés cada semana. Tocá una para verla o cambiarla, o un día para ver
              todo lo de ese día.
            </p>
            {/* Sin materias no se puede cargar nada: cada clase es de una. */}
            {sinMaterias ? (
              <p className="availability-warning">
                Todavía no elegiste qué materias das, así que no podés cargar clases.{' '}
                <Link className="auth-link" to="/perfil">
                  Agregalas desde tu perfil
                </Link>
                .
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary availability-add"
            onClick={this.handleAdd}
            disabled={sinMaterias}
          >
            <PlusIcon />
            Agregar clase
          </button>
        </div>

        {error ? <Banner type="danger">{error}</Banner> : null}

        <WeekCalendar
          weekStart={weekStart}
          windows={windows}
          loading={loading}
          today={this.getToday()}
          showingThisWeek={this.isThisWeek()}
          onPrev={this.handlePrevWeek}
          onNext={this.handleNextWeek}
          onToday={this.handleThisWeek}
          onOpenDay={this.handleOpenDay}
          onOpenWindow={this.handleOpenWindow}
        />

        {dialog ? (
          <DayWindowsDialog
            // Una clave por apertura y no por día: remontarlo en cada flecha
            // remontaría también el Modal, y el foco saltaría al primer botón
            // en vez de quedarse en la flecha que se tocó.
            key={dialog.key}
            iso={dialog.iso}
            focusId={dialog.focusId}
            windows={windows}
            loading={loading}
            subjects={subjects}
            today={this.getToday()}
            onChangeDay={this.handleChangeDay}
            onChanged={this.handleChanged}
            onClose={this.handleCloseDialog}
          />
        ) : null}
      </div>
    )
  }
}

export default TeacherAvailability

import { Component } from 'react'
import { Link } from 'react-router-dom'
import WeekCalendar from './WeekCalendar.jsx'
import DayWindowsDialog from './DayWindowsDialog.jsx'
import Banner from '../../components/Banner.jsx'
import { PlusIcon } from '../../components/icons.jsx'
import { fetchMyWindows, fetchSubjects } from '../../api/client.js'
import { addDays, fromISODate, toISODate } from '../../utils/calendar.js'
import { resolveRates } from '../../utils/rates.js'
import { startOfWeek } from '../../utils/windows.js'

/**
 * La disponibilidad del docente: la semana como calendario de solo lectura y,
 * encima, el modal de un día para cargar o cambiar horarios. Un horario dice
 * cuándo y cómo (modalidad, cupo); qué materia y cuánto dura lo elige el
 * alumno, entre las materias que el docente tarifó en su perfil.
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
        // Sin catálogo las tarifas se muestran sin el nombre de la materia,
        // pero la semana se sigue viendo y se puede cargar igual.
      })
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  getToday() {
    return toISODate(new Date())
  }

  /** Las tarifas del perfil, con el nombre de la materia. */
  getRates() {
    return resolveRates(this.props.user?.rates, this.state.catalog)
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
   * "Agregar horario" arriba de todo: abre el modal en HOY, con las clases que
   * ya hay ese día, y el formulario se abre recién con el "Agregar horario" de
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
    const rates = this.getRates()
    const sinTarifas = rates.length === 0

    return (
      <div className="teacher-availability">
        <div className="availability-editor-head">
          <div>
            <h1 className="availability-title">Disponibilidad</h1>
            <p className="availability-hint">
              Los horarios en que das clases cada semana. En cada uno, el alumno elige la materia y
              cuánto dura su clase. Tocá un horario para verlo o cambiarlo, o un día para ver todo
              lo de ese día.
            </p>
            {/* Sin tarifas no hay nada que el alumno pueda reservar: la
                materia y el precio salen de ahí. */}
            {sinTarifas ? (
              <p className="availability-warning">
                Todavía no pusiste cuánto cobrás tus materias, así que no podés cargar horarios.{' '}
                <Link className="auth-link" to="/perfil">
                  Cargá tus tarifas en tu perfil
                </Link>
                .
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-primary availability-add"
            onClick={this.handleAdd}
            disabled={sinTarifas}
          >
            <PlusIcon />
            Agregar horario
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
            rates={rates}
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

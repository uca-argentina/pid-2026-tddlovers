import { Component } from 'react'
import { Link, Navigate } from 'react-router-dom'
import withRouter from '../../routes/withRouter.jsx'
import WeekScheduler from './WeekScheduler.jsx'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { fetchAvailabilityByTeacher, saveAvailability } from '../../api/client.js'
import BookingBoard from '../Booking/BookingBoard.jsx'
import {
  findShortRuns,
  formatShortRunsError,
  rangesToSlotIds,
  runsToSlotIds,
  sameSlots,
  slotIdsToRanges,
} from '../../utils/availability.js'
import './AvailabilityPage.css'

// Cuando no hay nada que marcar, SIEMPRE el mismo objeto: lo que sale de acá
// baja hasta el shouldComponentUpdate de cada columna, y un Set nuevo en cada
// render redibujaría las 7 columnas en cada paso del arrastre.
const SIN_TRAMOS_CORTOS = { slotIds: null, runs: [], ids: new Set() }

/**
 * Disponibilidad semanal del docente: pinta las medias horas en las que da
 * clase. Las clases duran 1 h y arrancan en punto o y media (ver CLAUDE.md),
 * así que la unidad de la grilla es la media hora y dos seguidas son una
 * clase.
 *
 * Es UNA semana, no una por materia: el docente dice cuándo puede, y es el
 * alumno el que elige para qué materia reserva (entre las que da el docente).
 *
 * Mirando como alumno, la misma ruta muestra otra cosa: el tablero para
 * buscar horarios libres y reservar (ver pages/Booking). Por eso el primer
 * guard de renderBody es el rol y no el usuario. /disponibilidad/:materiaId
 * solo tiene sentido ahí — deja esa materia filtrada.
 */
class AvailabilityPage extends Component {
  state = {
    slotIds: new Set(),
    // Lo último que devolvió el backend: con esto se sabe si hay cambios sin
    // guardar y es a lo que vuelve "Cancelar".
    savedSlotIds: new Set(),
    loading: false,
    loadError: null,
    saving: false,
    saveError: null,
    saved: false,
    // "¿Ya intentó guardar y no se pudo?". Mientras está en false, pintar es
    // silencioso: nadie quiere que le marquen en rojo una media hora que
    // todavía está por completar. Una vez que dijo que no, el aviso se
    // recalcula en cada render hasta que no quede ninguno.
    showShortRuns: false,
  }

  // Mismo patrón que CalendarPage: descarta respuestas que llegaron tarde.
  fetchToken = 0

  // Cache de un solo valor. La clave es la identidad del Set de slots, que
  // sirve porque WeekScheduler nunca muta el que recibe: siempre emite uno
  // nuevo (ver SIN_TRAMOS_CORTOS para por qué importa).
  shortRunsCache = SIN_TRAMOS_CORTOS

  componentDidMount() {
    if (this.shouldLoad(this.props)) this.loadAvailability()
  }

  componentDidUpdate(prevProps) {
    // React Router reusa la misma instancia al redirigir de
    // /disponibilidad/:materiaId a /disponibilidad (y al cambiar el rol con el
    // interruptor), así que componentDidMount no vuelve a correr: se carga
    // cuando la grilla PASA a ser editable.
    if (!this.shouldLoad(prevProps) && this.shouldLoad(this.props)) this.loadAvailability()
  }

  /**
   * Con materia en la URL el docente se redirige (ver renderBody): pedir ahí
   * sería un fetch que se tira.
   */
  shouldLoad(props) {
    const editable = Boolean(props.user) && props.viewRole === 'teacher'
    return editable && !props.router.params.materiaId
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  /** Solo la usa el tablero del alumno: el docente edita una sola semana. */
  getSubjectId() {
    return this.props.router.params.materiaId || null
  }

  hasSubjects() {
    return (this.props.user?.subjectIds || []).length > 0
  }

  hasChanges() {
    return !sameSlots(this.state.slotIds, this.state.savedSlotIds)
  }

  /** { runs, ids } de los tramos que duran menos que una clase. */
  getShortRuns() {
    const { slotIds, showShortRuns } = this.state
    if (!showShortRuns) return SIN_TRAMOS_CORTOS

    if (this.shortRunsCache.slotIds !== slotIds) {
      const runs = findShortRuns(slotIds)
      this.shortRunsCache = { slotIds, runs, ids: runsToSlotIds(runs) }
    }
    return this.shortRunsCache
  }

  loadAvailability = () => {
    const token = ++this.fetchToken
    this.setState({
      loading: true,
      loadError: null,
      saved: false,
      showShortRuns: false,
    })

    fetchAvailabilityByTeacher(this.props.user.id)
      .then((schedule) => {
        if (token !== this.fetchToken) return
        const slotIds = rangesToSlotIds(schedule)
        this.setState({ slotIds, savedSlotIds: slotIds, loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          loadError: error.message || 'No se pudo cargar la disponibilidad.',
        })
      })
  }

  handleChangeSlots = (slotIds) => {
    this.setState({ slotIds, saved: false })
  }

  handleCancel = () => {
    this.setState((prev) => ({
      slotIds: prev.savedSlotIds,
      saveError: null,
      saved: false,
      showShortRuns: false,
    }))
  }

  handleSubmit = (event) => {
    event.preventDefault()

    // La regla es del dominio (una clase dura 1 h), así que se corta acá y no
    // se manda: el backend lo rechazaría igual, pero sin decir cuál.
    const cortos = findShortRuns(this.state.slotIds)
    if (cortos.length > 0) {
      this.setState({ showShortRuns: true, saveError: null, saved: false })
      return
    }

    const schedule = slotIdsToRanges(this.state.slotIds)
    this.setState({ saving: true, saveError: null, saved: false })

    saveAvailability(schedule)
      .then(() => {
        this.setState((prev) => ({
          saving: false,
          saved: true,
          savedSlotIds: prev.slotIds,
          showShortRuns: false,
        }))
      })
      .catch((error) => {
        this.setState({
          saving: false,
          saveError: error.message || 'No se pudieron guardar los horarios.',
        })
      })
  }

  /**
   * La pantalla del alumno: buscar horarios libres y (desde la ronda 2)
   * reservar. Va PRIMERO en renderBody y sin pedir usuario, igual que el
   * placeholder que reemplaza — las rutas de la app no tienen portero.
   *
   * Se le pasa `router` en vez de envolver BookingBoard en otro withRouter:
   * con un puente por ruta alcanza, y así sigue siendo obvio que los hooks
   * viven en un solo archivo.
   */
  renderStudentBooking() {
    return (
      <BookingBoard
        router={this.props.router}
        user={this.props.user}
        subjectId={this.getSubjectId()}
      />
    )
  }

  renderScheduler() {
    const { slotIds, saving, saveError, saved, loadError } = this.state
    // El cartel se deriva en cada render y no se guarda en el estado: si se
    // guardara, seguiría nombrando un horario que el docente ya arregló.
    const { runs, ids } = this.getShortRuns()
    const shortRunsError = formatShortRunsError(runs)

    return (
      <form className="availability-editor" onSubmit={this.handleSubmit}>
        <div className="availability-editor-head">
          <h1 className="availability-title">Disponibilidad</h1>
          <p className="availability-hint">
            Pintá las medias horas en las que podés dar clase. Podés arrastrar para marcar un rato
            entero y usar el botón de cada día para copiarlo a los demás. Cuando un alumno reserve,
            va a elegir para qué materia es.
          </p>
          {/* Sin materias el backend no lo muestra en el tablero: no habría
              nada que reservarle. Se avisa acá para que no piense que cargó
              horarios y nadie los ve. */}
          {this.hasSubjects() ? null : (
            <p className="availability-warning">
              Todavía no elegiste qué materias das, así que los alumnos no van a ver estos horarios.{' '}
              <Link className="auth-link" to="/perfil">
                Agregalas desde tu perfil
              </Link>
              .
            </p>
          )}
        </div>

        {loadError ? <Banner type="danger">{loadError}</Banner> : null}
        {saveError ? <Banner type="danger">{saveError}</Banner> : null}
        {shortRunsError ? <Banner type="danger">{shortRunsError}</Banner> : null}
        {saved ? <Banner type="success">Listo, guardamos tus horarios.</Banner> : null}

        <WeekScheduler
          value={slotIds}
          savedIds={this.state.savedSlotIds}
          invalidIds={ids}
          shortRuns={runs}
          onChange={this.handleChangeSlots}
          disabled={saving}
        />

        <div className="btn-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={this.handleCancel}
            disabled={!this.hasChanges() || saving}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!this.hasChanges() || saving}
          >
            {saving ? <SpinnerIcon className="spin" /> : null}
            Guardar cambios
          </button>
        </div>
      </form>
    )
  }

  renderBody() {
    const { user, viewRole } = this.props

    // La vista de alumno va PRIMERO y no pide usuario: es informativa y las
    // rutas de la app no tienen portero (ver App.jsx). El login solo hace
    // falta para editar.
    if (viewRole !== 'teacher') return this.renderStudentBooking()

    if (!user) {
      return (
        <div className="availability-empty">
          <p>Iniciá sesión para cargar tu disponibilidad.</p>
          <Link className="auth-link" to="/ingresar">
            Ir al login
          </Link>
        </div>
      )
    }

    // Links viejos del perfil (una disponibilidad por materia): al docente
    // la materia no le dice nada acá, así que se limpia la URL.
    if (this.getSubjectId() !== null) return <Navigate to="/disponibilidad" replace />

    if (this.state.loading) {
      return (
        <div className="availability-empty">
          <SpinnerIcon className="spin" />
          <p className="availability-hint">Cargando tus horarios...</p>
        </div>
      )
    }

    return this.renderScheduler()
  }

  render() {
    // El tablero del alumno se clava al alto de la pantalla (el calendario
    // ocupa todo lo que hay y las tarjetas scrollean adentro); las otras
    // vistas de esta ruta son documentos que crecen para abajo y scrollean en
    // .app-main.
    const esTablero = this.props.viewRole !== 'teacher'

    return (
      <div className={`availability-page ${esTablero ? 'is-board' : ''}`}>{this.renderBody()}</div>
    )
  }
}

AvailabilityPage.defaultProps = {
  viewRole: 'student',
}

export default withRouter(AvailabilityPage)

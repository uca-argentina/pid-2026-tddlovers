import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import MonthPane from './MonthPane.jsx'
import DayAgenda from './DayAgenda.jsx'
import withFavorites from '../../routes/withFavorites.jsx'
import { addDays, groupByDate, toISODate } from '../../utils/calendar.js'
import { fetchClasses } from '../../api/client.js'
import { groupTurns } from '../../utils/reservations.js'
import './CalendarPage.css'

// Hasta dónde se buscan solicitudes pendientes para el aviso del docente.
const PENDING_LOOKAHEAD_DAYS = 90

/**
 * Pantalla principal: a la derecha el calendario del mes (con las clases de
 * cada día adentro de cada casillero, estilo calendario de Apple) y a la
 * izquierda el detalle del día seleccionado. Es la primera pantalla que ve
 * alguien que entra a la app.
 *
 * El fetch no arranca en componentDidMount sino cuando MonthPane avisa qué
 * rango abarca la grilla (onRangeChange), que pasa al montarse y cada vez que
 * recarga cuando se cambia de mes.
 *
 * El calendario en sí (el mes visible, las flechas, la animación y la medición
 * de cuántas líneas entran por celda) vive en MonthPane, que comparte con la
 * pantalla de reservar: acá solo queda de dónde salen los datos.
 *
 * Los favoritos del alumno (el corazón al lado del docente) los baja
 * withFavorites.
 *
 * Rol: docente y alumno (ruta "/"; el admin es redirigido a /admin en App).
 *
 * Props:
 *   - viewRole: 'teacher' | 'student', de App (roleOf(user)).
 *   - favoriteIds, favoriteError, onFavoriteChange, onFavoriteError: de
 *     withFavorites (solo con viewRole 'student'); se reenvían a DayAgenda.
 *
 * Datos (api/client.js):
 *   - fetchClasses → GET /api/classes?from&to, cada vez que MonthPane avisa
 *     el rango de la grilla. Devuelve las clases del usuario de la sesión
 *     (una fila por reserva).
 *   - fetchClasses → GET /api/classes?from=hoy&to=hoy+90&status=pendiente,
 *     solo para el docente, al montar y después de cada cambio de una clase
 *     (para el aviso "Tenés N solicitudes").
 *
 * Estado:
 *   - selectedIso: día elegido en MonthPane ("YYYY-MM-DD").
 *   - classes: filas de GET /api/classes del rango; classesLoading/Error.
 *   - pendingCount: reservas pendientes del docente en los próximos 90 días.
 */
class CalendarPage extends Component {
  state = {
    selectedIso: toISODate(new Date()),
    classes: [],
    classesLoading: false,
    classesError: null,
    // Solo para el docente: cuántas reservas esperan que responda, en
    // cualquier mes (no solo el que se está mirando).
    pendingCount: 0,
  }

  // Contador para descartar respuestas viejas: si se cambia de mes mientras
  // una request está en vuelo, la que llega tarde no tiene que pisar el
  // estado. También neutraliza el doble montaje que hace <StrictMode> en
  // desarrollo.
  fetchToken = 0

  pendingToken = 0

  componentDidMount() {
    if (this.props.viewRole === 'teacher') this.loadPending()
  }

  componentDidUpdate(prevProps) {
    // El aviso depende del rol: si cambia (otra sesión en la misma app), se
    // pide de nuevo o se olvida, para no mostrarle a nadie el de otro.
    if (prevProps.viewRole === this.props.viewRole) return
    if (this.props.viewRole === 'teacher') this.loadPending()
    else {
      this.pendingToken += 1
      this.setState({ pendingCount: 0 })
    }
  }

  componentWillUnmount() {
    this.fetchToken += 1
    this.pendingToken += 1
  }

  /**
   * Cuenta las solicitudes pendientes del docente: fetchClasses con
   * status=pendiente (GET /api/classes) de hoy a hoy + 90 días → `pendingCount`.
   */
  loadPending = () => {
    const token = ++this.pendingToken
    const hoy = new Date()
    fetchClasses({
      from: toISODate(hoy),
      to: toISODate(addDays(hoy, PENDING_LOOKAHEAD_DAYS)),
      status: 'pendiente',
    })
      .then((pendientes) => {
        if (token !== this.pendingToken) return
        // Defensivo: no depender de que el backend respete el filtro.
        this.setState({
          pendingCount: pendientes.filter((item) => item.status === 'pendiente').length,
        })
      })
      .catch(() => {
        // El aviso es un extra: si falla, el calendario sigue andando.
      })
  }

  /**
   * Las clases agrupadas por fecha ISO, cada lista ordenada por hora.
   *
   * Esta pantalla es "mis clases": todo lo que sigue en pie, en cualquier
   * estado. Una clase cancelada para todos no ocupa lugar en el calendario
   * (se ve en "Mis reservas").
   *
   * Una grupal llega como una fila por alumno (así está en la base), pero es
   * UNA clase: va una vez, como la reserva que representa al turno, con
   * `turnKey` y todas sus reservas en `rows` (las canceladas también, al
   * final, como en el detalle de Mis reservas). El docente acepta y toma
   * lista de a uno desde el detalle. MonthPane solo mira id, startTime y
   * subjectName, así que la forma plana le sirve igual.
   */
  getClassesByDate() {
    const clases = groupTurns(this.state.classes)
      .filter((turn) => turn.active.length > 0)
      .map((turn) => ({ ...turn.cls, turnKey: turn.key, rows: turn.rows }))
    return groupByDate(clases)
  }

  /** MonthPane avisa qué rango abarca la grilla; recién ahí se pide. */
  handleRangeChange = (from, to) => {
    this.loadClasses(from, to)
  }

  /**
   * Trae las clases del usuario entre `from` y `to` ("YYYY-MM-DD", el rango
   * de la grilla de MonthPane) con fetchClasses → GET /api/classes?from&to y
   * las guarda en `classes`. Maneja classesLoading/classesError.
   */
  loadClasses = (from, to) => {
    const token = ++this.fetchToken

    this.setState({ classesLoading: true, classesError: null })
    fetchClasses({ from, to })
      .then((classes) => {
        if (token !== this.fetchToken) return
        this.setState({ classes, classesLoading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          classesLoading: false,
          classesError: error.message || 'No se pudieron cargar las clases.',
        })
      })
  }

  handleSelectDay = (iso) => {
    this.setState({ selectedIso: iso })
  }

  /**
   * Una reserva cambió de estado (la aceptó, la pagó, la canceló): se
   * reemplaza esa fila y listo, no hace falta volver a pedir el mes. Si quedó
   * cancelada va al final de su turno, y el turno sale del calendario solo si
   * ya no queda nadie.
   */
  handleClassChange = (updated) => {
    if (!updated?.id) return
    this.setState((prev) => ({
      classes: prev.classes.map((item) => (String(item.id) === String(updated.id) ? updated : item)),
    }))
    if (this.props.viewRole === 'teacher') this.loadPending()
  }

  renderPending() {
    const { pendingCount } = this.state
    if (this.props.viewRole !== 'teacher' || pendingCount === 0) return null
    return (
      <p className="calendar-pending" role="status">
        {pendingCount === 1
          ? 'Tenés 1 solicitud de clase esperando respuesta.'
          : `Tenés ${pendingCount} solicitudes de clase esperando respuesta.`}{' '}
        <Link to="/reservas">Ver solicitudes</Link>
      </p>
    )
  }

  render() {
    const { selectedIso, classesLoading, classesError } = this.state
    const classesByDate = this.getClassesByDate()

    return (
      <div className="calendar-page">
        <MonthPane
          eventsByDate={classesByDate}
          selectedIso={selectedIso}
          loading={classesLoading}
          onSelectDay={this.handleSelectDay}
          onRangeChange={this.handleRangeChange}
        >
          {this.renderPending()}
          {classesError ? <Banner type="danger">{classesError}</Banner> : null}
        </MonthPane>

        {/* Va después en el DOM pero se dibuja a la izquierda (order en el
            CSS): el calendario es el contenido principal y el detalle es
            complementario. En pantallas chicas se apilan en el orden del
            DOM, que es el que conviene ahí. */}
        <aside className="calendar-aside">
          {this.props.favoriteError ? (
            <Banner type="danger">{this.props.favoriteError}</Banner>
          ) : null}
          <DayAgenda
            classesByDate={classesByDate}
            selectedIso={selectedIso}
            loading={classesLoading}
            viewRole={this.props.viewRole}
            favoriteIds={this.props.favoriteIds}
            onClassChange={this.handleClassChange}
            onFavoriteChange={this.props.onFavoriteChange}
            onFavoriteError={this.props.onFavoriteError}
          />
        </aside>
      </div>
    )
  }
}

export default withFavorites(CalendarPage)

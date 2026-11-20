import { Component } from 'react'
import MonthPane from '../Calendar/MonthPane.jsx'
import BookingFilters from './BookingFilters.jsx'
import BookingResults from './BookingResults.jsx'
import BookingDialog from './BookingDialog.jsx'
import Banner from '../../components/Banner.jsx'
import Modal from '../../components/Modal.jsx'
import SearchBar from '../../components/SearchBar.jsx'
import { FilterIcon, HeartIcon } from '../../components/icons.jsx'
import withViewport from '../../routes/withViewport.jsx'
import withFavorites from '../../routes/withFavorites.jsx'
import {
  fetchAvailability,
  fetchClass,
  fetchMyLessons,
  fetchMyPacks,
  fetchNeuronas,
  fetchSubjects,
} from '../../api/client.js'
import { formatDayLong, fromISODate, toISODate } from '../../utils/calendar.js'
import {
  EMPTY_BOOKING_FILTERS,
  countBookableByDate,
  countBookingFilters,
  filterCards,
  filterSubjectsFor,
  groupCardsByDate,
} from '../../utils/booking.js'
import { packsForReschedule } from '../../utils/packs.js'
import { resolveQuery } from '../../utils/search.js'
import { MODALITIES } from '../../utils/windows.js'
import './BookingBoard.css'

// Los chips rápidos del teléfono: lo que más se toca, sin abrir la hoja.
const QUICK_KINDS = [
  { key: 'individual', label: 'Individual' },
  { key: 'group', label: 'Grupal' },
]

/**
 * La pantalla del alumno: buscar clases para reservar. A la derecha el
 * calendario del mes y a la izquierda las clases del día elegido, con los
 * filtros arriba.
 *
 * Una tarjeta es un horario que ofrece un docente un día: rango, modalidad y
 * cupo los fijó el docente; la materia (entre las que tarifó), la hora de
 * inicio y la duración las elige el alumno en el modal (o se suma a una
 * grupal ya armada). Qué horarios se ven lo decide el backend para ESTE
 * alumno: sin lo completo, sin lo que le choca con sus clases, sin lo pasado
 * (lib/availabilityExpansion.js). Acá solo se aplican los filtros que elige
 * el alumno, todos en utils/booking.js.
 *
 * Con ?reprogramar=<id> la misma pantalla sirve para reprogramar una clase
 * confirmada: el backend (excludeClassId) manda solo los horarios del mismo
 * docente con la misma materia, y el modal pide el cambio en vez de una
 * reserva nueva.
 *
 * El `router` llega por props desde AvailabilityPage en vez de envolver esto
 * en otro withRouter: alcanza con un puente por ruta y así sigue siendo obvio
 * que los hooks viven en un solo archivo.
 *
 * En el teléfono (`mobile`) se arma distinto: título grande, el buscador
 * (que ahí no está en la barra), una fila de chips rápidos con el botón
 * "Filtros" que abre todos en una hoja, la tira de semana y la lista del día.
 * Los filtros y su estado son los mismos: solo cambia dónde se tocan.
 *
 * Rol: alumno (AvailabilityPage la muestra para todo viewRole que no sea
 * 'teacher', así que también sin sesión).
 *
 * Props:
 *   - router: { navigate, location, searchParams, setSearchParams, … } de
 *     withRouter, que AvailabilityPage recibe y reenvía tal cual. De la URL se
 *     leen `?q=` (búsqueda del navbar) y `?reprogramar=<classId>`.
 *   - user: el usuario de la sesión (App → AvailabilityPage → acá), o null.
 *   - mobile: de withViewport.
 *   - favoriteIds, favoriteError, onFavoriteChange, onFavoriteError: de
 *     withFavorites (configurado para mirar `user.role`).
 *
 * Datos (api/client.js):
 *   - fetchSubjects → GET /api/subjects, al montar (catálogo para los chips).
 *   - fetchAvailability → GET /api/availability?from&to[&excludeClassId], y
 *     fetchMyLessons → GET /api/classes?from&to, cada vez que MonthPane avisa
 *     un rango nuevo (onRangeChange) o cambia el usuario / la reprogramación.
 *   - fetchClass → GET /api/classes/:id, si hay ?reprogramar=<id>.
 *   - fetchMyPacks → GET /api/packs/mine y fetchNeuronas → GET /api/neuronas,
 *     solo con un alumno logueado (al montar, al cambiar `user` y después de
 *     reservar con paquete/canje o reprogramar).
 *
 * Estado:
 *   - selectedIso: día elegido ("YYYY-MM-DD"); arranca hoy, lo cambia MonthPane.
 *   - from/to: rango visible que reportó MonthPane (onRangeChange).
 *   - slots: filas (ventana × fecha) de GET /api/availability.
 *   - myLessons: clases propias del rango (GET /api/classes), solo para
 *     pintar las líneas del calendario.
 *   - subjects: catálogo de GET /api/subjects.
 *   - loading/error: del último pedido de rango (o de la reprogramación).
 *   - booking: tarjeta abierta en BookingDialog; booked: lo que devolvió el
 *     modal tras reservar (para el cartel verde).
 *   - rescheduling: la clase de GET /api/classes/:id que se reprograma.
 *   - packs / neuronasBalance: de /api/packs/mine y /api/neuronas.
 *   - filters: ver EMPTY_BOOKING_FILTERS en utils/booking.js.
 *   - filtersOpen: hoja de filtros abierta (solo teléfono).
 */
class BookingBoard extends Component {
  state = {
    selectedIso: toISODate(new Date()),
    from: null,
    to: null,
    slots: [],
    myLessons: [],
    subjects: [],
    loading: false,
    error: null,
    // La tarjeta que se está reservando, o null si el modal está cerrado.
    booking: null,
    booked: null,
    // La clase que se está reprogramando (?reprogramar=<id>), o null.
    rescheduling: null,
    // Los paquetes que compró el alumno: cada tarjeta dice cuántas clases le
    // quedan con ese docente, y el modal ofrece reservar con el paquete.
    packs: [],
    neuronasBalance: 0,
    // Los favoritos (favoriteIds, favoriteError) llegan por props desde
    // withFavorites, igual que en el Calendario y Mis reservas.
    // Los filtros, todos juntos (ver EMPTY_BOOKING_FILTERS): se leen, cuentan
    // y limpian de una, y bajan así a BookingFilters.
    filters: EMPTY_BOOKING_FILTERS,
    // Solo en el teléfono: si la hoja de filtros está abierta.
    filtersOpen: false,
  }

  // Dos contadores y no uno: si un cambio de mes compartiera token con el
  // catálogo, cambiar de mes descartaría en silencio un fetchSubjects en
  // vuelo.
  rangeToken = 0

  subjectsToken = 0

  rescheduleToken = 0

  studentToken = 0

  componentDidMount() {
    this.loadSubjects()
    this.applyQuery()
    this.loadReschedule()
    this.loadStudentData()
  }

  componentDidUpdate(prevProps) {
    // FILTRO: "Solo favoritos" se apaga si el usuario dejó de ser alumno
    // (regla de pantalla), para no filtrar con una lista que ya no existe.
    // Además se recargan paquetes y saldo; los favoritos los recarga
    // withFavorites.
    if (prevProps.user !== this.props.user) {
      this.loadStudentData()
      if (!this.isStudent() && this.state.filters.onlyFavorites) {
        this.setState((prev) => ({ filters: { ...prev.filters, onlyFavorites: false } }))
      }
    }
    const cambioUsuario = prevProps.user?.id !== this.props.user?.id
    let cambioReprogramar = false
    if (prevProps.router.location.search !== this.props.router.location.search) {
      this.applyQuery()
      cambioReprogramar = prevProps.router.searchParams.get('reprogramar') !== this.getRescheduleId()
      if (cambioReprogramar) this.loadReschedule()
    }
    // El rango cargado depende de los dos: el backend recorta los horarios
    // con las clases del alumno de la sesión, y al reprogramar saca la clase
    // vieja de lo ocupado.
    const { from, to } = this.state
    if ((cambioUsuario || cambioReprogramar) && from && to) this.loadRange(from, to)
  }

  componentWillUnmount() {
    this.rangeToken += 1
    this.subjectsToken += 1
    this.rescheduleToken += 1
    this.studentToken += 1
  }

  isStudent() {
    return this.props.user?.role === 'student'
  }

  /**
   * Los paquetes y el saldo de neuronas: solo un alumno logueado los tiene.
   * Si uno falla, el tablero sigue andando sin él: no se ofrece reservar con
   * paquete, o no se ofrecen canjes.
   *
   * Pide en paralelo fetchMyPacks (GET /api/packs/mine) y fetchNeuronas
   * (GET /api/neuronas, se usa solo `.balance`) y llena `packs` y
   * `neuronasBalance`. Sin alumno los deja en [] y 0.
   */
  loadStudentData() {
    const token = ++this.studentToken
    if (!this.isStudent()) {
      this.setState({ packs: [], neuronasBalance: 0 })
      return
    }
    Promise.allSettled([fetchMyPacks(), fetchNeuronas()]).then(([packs, neuronas]) => {
      if (token !== this.studentToken) return
      this.setState({
        packs: packs.status === 'fulfilled' ? packs.value : [],
        neuronasBalance: neuronas.status === 'fulfilled' ? neuronas.value.balance : 0,
      })
    })
  }

  /** El id de ?reprogramar=<classId> en la URL, o null. */
  getRescheduleId() {
    return this.props.router.searchParams.get('reprogramar')
  }

  /**
   * Si la URL trae ?reprogramar=<id>, trae esa clase con fetchClass
   * (GET /api/classes/:id) y la guarda en `rescheduling`; si no, la limpia.
   * Si falla, deja el mensaje del backend en `error`.
   */
  loadReschedule() {
    const token = ++this.rescheduleToken
    const id = this.getRescheduleId()
    if (!id) {
      this.setState({ rescheduling: null })
      return
    }
    fetchClass(id)
      .then((cls) => {
        if (token !== this.rescheduleToken) return
        this.setState({ rescheduling: cls })
      })
      .catch((error) => {
        if (token !== this.rescheduleToken) return
        this.setState({
          rescheduling: null,
          error: error.message || 'No se encontró la clase a reprogramar.',
        })
      })
  }

  /** Saca un parámetro de la URL sin tocar los demás, y sin sumar al historial. */
  dropParam(name) {
    const params = new URLSearchParams(this.props.router.searchParams)
    if (!params.has(name)) return
    params.delete(name)
    this.props.router.setSearchParams(params, { replace: true })
  }

  /** El texto de ?q= (lo pone SearchBar al buscar), o ''. */
  getQuery() {
    return this.props.router.searchParams.get('q') || ''
  }

  /**
   * Qué significa lo que se buscó arriba: si es el nombre de una materia se
   * comporta como si se hubiera tocado ese chip, y si no es texto libre
   * (docente o materia). Se vuelve a correr cuando cambia la URL, no en cada
   * render.
   *
   * Recibe el catálogo (por defecto el del state) y usa resolveQuery
   * (utils/search.js) para pisar `filters.subjectIds` y `filters.teacherQuery`.
   */
  applyQuery(subjects = this.state.subjects) {
    const q = this.getQuery()
    if (!q) return

    const { subjectId, teacherQuery } = resolveQuery(q, subjects)
    this.setState((prev) => ({
      filters: { ...prev.filters, teacherQuery, subjectIds: subjectId ? [subjectId] : [] },
    }))
  }

  /**
   * El `q` es una forma de ENTRAR con algo filtrado, no un filtro que se
   * queda: apenas el alumno toca cualquier chip a mano, se va de la URL. Con
   * replace, así el botón de atrás sigue sirviendo para volver de pantalla.
   */
  dropQuery() {
    // Solo el q: si se está reprogramando, tocar un filtro no puede cortar
    // la reprogramación.
    this.dropParam('q')
  }

  /** Trae el catálogo con fetchSubjects (GET /api/subjects) y lo guarda en `subjects`. */
  loadSubjects = () => {
    const token = ++this.subjectsToken
    fetchSubjects()
      .then((subjects) => {
        if (token !== this.subjectsToken) return
        this.setState({ subjects })
        // El catálogo llega después que la URL, así que recién acá se puede
        // saber si lo buscado era una materia.
        this.applyQuery(subjects)
      })
      .catch(() => {
        // El catálogo solo alimenta los chips: si falla, la pantalla sigue
        // andando sin el filtro por materia.
        if (token === this.subjectsToken) this.setState({ subjects: [] })
      })
  }

  /**
   * Carga los horarios y las clases propias del rango [from, to] que muestra
   * MonthPane ("YYYY-MM-DD").
   *
   * - fetchAvailability → GET /api/availability?from&to (con excludeClassId =
   *   la clase que se reprograma: el backend no la cuenta como ocupada y
   *   devuelve solo ese docente y esa materia) → `slots`.
   * - fetchMyLessons → GET /api/classes?from&to (las del usuario de la
   *   sesión) → `myLessons`, para las líneas del calendario; sin usuario, [].
   * Maneja `loading` y `error`; descarta respuestas viejas con rangeToken.
   */
  loadRange = (from, to) => {
    const token = ++this.rangeToken
    this.setState({ loading: true, error: null })

    const pedidos = [fetchAvailability({ from, to, excludeClassId: this.getRescheduleId() })]
    // Sin usuario no hay clases propias que dibujar.
    pedidos.push(this.props.user ? fetchMyLessons({ from, to }) : Promise.resolve([]))

    Promise.all(pedidos)
      .then(([slots, myLessons]) => {
        if (token !== this.rangeToken) return
        this.setState({ slots, myLessons, loading: false })
      })
      .catch((error) => {
        if (token !== this.rangeToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar los horarios.',
        })
      })
  }

  /** Los paquetes del alumno, con lo que libera la clase que se reprograma. */
  getPacks() {
    return packsForReschedule(this.state.packs, this.state.rescheduling)
  }

  /**
   * FILTRO: lo que recibe filterCards (utils/booking.js), elegido por el
   * alumno. "Solo favoritos" pasa a ser la lista de esos docentes.
   */
  getFilters() {
    const { filters } = this.state
    // favoriteIds es null si el pedido falló: con "Solo favoritos" prendido
    // eso es "ninguno", no "sin filtro".
    const teacherIds = filters.onlyFavorites ? this.props.favoriteIds || [] : null
    return { ...filters, teacherIds }
  }

  hasFilters() {
    return countBookingFilters(this.state.filters) > 0
  }

  /**
   * FILTRO: las tarjetas filtradas por lo que eligió el alumno (filterCards;
   * lo que no se ve por regla ya no vino del backend) y agrupadas por fecha
   * (groupCardsByDate, que además pone primero las de docentes Destacados):
   * `{ "YYYY-MM-DD": [tarjeta, …] }`.
   */
  getFilteredByDate() {
    return groupCardsByDate(filterCards(this.state.slots, this.getFilters()))
  }

  /**
   * FILTRO: el número verde de cada día, sin las de licencia
   * (countBookableByDate en utils/booking.js). Es la cantidad de TARJETAS y
   * respeta los filtros, así que lo que dice el calendario es exactamente lo
   * que se ve al tocar ese día.
   */
  getFreeByDate(porFecha) {
    return countBookableByDate(porFecha)
  }

  /** Las clases propias agrupadas por día, que son las líneas azules. */
  getLessonsByDate() {
    const map = {}
    for (const lesson of this.state.myLessons) {
      if (!map[lesson.date]) map[lesson.date] = []
      map[lesson.date].push(lesson)
    }
    for (const iso of Object.keys(map)) {
      map[iso].sort((a, b) => a.startTime.localeCompare(b.startTime))
    }
    return map
  }

  /**
   * FILTRO: los chips de materia, solo las que se pueden reservar en el rango
   * cargado (filterSubjectsFor en utils/booking.js).
   */
  getFilterSubjects() {
    return filterSubjectsFor(this.state.slots, this.state.subjects, this.state.filters.subjectIds)
  }

  handleRangeChange = (from, to) => {
    this.setState({ from, to })
    this.loadRange(from, to)
  }

  handleSelectDay = (iso) => {
    // El aviso de reservado habla del día que se acaba de reservar: al
    // cambiarse de día deja de tener sentido y se va.
    this.setState({ selectedIso: iso, booked: null })
  }

  /**
   * Prende o apaga un filtro: en las listas (días, materias, modalidad, tipo)
   * agrega o saca `value`; "Solo favoritos" es un sí/no y se da vuelta.
   */
  toggleFilter(key, value) {
    this.dropQuery()
    this.setState((prev) => {
      const actual = prev.filters[key]
      let siguiente = !actual
      if (Array.isArray(actual)) {
        siguiente = actual.includes(value)
          ? actual.filter((item) => item !== value)
          : [...actual, value]
      }
      return { filters: { ...prev.filters, [key]: siguiente } }
    })
  }

  /** Para un onClick: handleToggle('modalities', 'virtual'). */
  handleToggle = (key, value) => () => {
    this.toggleFilter(key, value)
  }

  setFilters(cambios) {
    this.dropQuery()
    this.setState((prev) => ({ filters: { ...prev.filters, ...cambios } }))
  }

  /**
   * El slider manda las dos puntas juntas: no se puede mover una sin saber
   * dónde quedó la otra (se empujan entre sí).
   */
  handleChangeRange = (fromTime, toTime) => {
    this.setFilters({ fromTime, toTime })
  }

  handleClearTeacher = () => {
    this.setFilters({ teacherQuery: '' })
  }


  handleClear = () => {
    this.setFilters(EMPTY_BOOKING_FILTERS)
  }

  handleOpenFilters = () => {
    this.setState({ filtersOpen: true })
  }

  handleCloseFilters = () => {
    this.setState({ filtersOpen: false })
  }

  handleReservar = (card) => () => {
    this.setState({ booking: card, booked: null })
  }

  handleCloseDialog = () => {
    this.setState({ booking: null })
  }

  /**
   * Reservada: se vuelve a pedir el mes entero en vez de tocar el estado a
   * mano. No es solo la tarjeta que se reservó la que cambia — ese horario
   * deja de ofrecerse en tarjetas de otros docentes que le chocan, y eso lo
   * decide el backend. Es una sola llamada.
   *
   * `booked` lo arma el modal con lo que hace falta para el cartel, el día
   * incluido: no se lee de `this.state.booking`, que es del modal y no de la
   * respuesta.
   */
  handleBooked = (booked) => {
    const { from, to } = this.state
    this.setState({ booking: null, booked, selectedIso: booked.date, rescheduling: null })
    // La reprogramación terminó: la pantalla vuelve a ser la de reservar. Al
    // salir el parámetro, componentDidUpdate recarga el rango.
    if (booked.rescheduled) this.dropParam('reprogramar')
    else if (from && to) this.loadRange(from, to)
    // Una clase con paquete aparta un lugar del paquete, un canje gasta
    // neuronas y reprogramar devuelve lo que usaba la vieja.
    if (booked.usedPack || booked.usedReward || booked.rescheduled) this.loadStudentData()
  }

  handleStopReschedule = () => {
    this.dropParam('reprogramar')
  }

  renderBanner() {
    const { error, booked } = this.state
    if (error) return <Banner type="danger">{error}</Banner>
    if (booked?.rescheduled) {
      return (
        <Banner type="success">
          Pediste el nuevo horario de {booked.subjectName} con {booked.teacherName}. Queda
          pendiente hasta que el docente la acepte, y después la tenés que volver a pagar.
        </Banner>
      )
    }
    if (booked) {
      return (
        <Banner type="success">
          Reservaste {booked.subjectName} con {booked.teacherName}. Queda pendiente hasta que el
          docente la acepte; ya la ves en tu calendario.
        </Banner>
      )
    }
    return this.renderRescheduling()
  }

  renderRescheduling() {
    const cls = this.state.rescheduling
    if (!cls) return null
    return (
      <div className="booking-reschedule" role="status">
        <p>
          Reprogramando tu clase de <strong>{cls.subjectName}</strong> con {cls.teacherName} del{' '}
          {formatDayLong(fromISODate(cls.date)).toLowerCase()} a las {cls.startTime}. Elegí un
          horario nuevo: el docente lo tiene que aceptar y la clase se vuelve a pagar.
        </p>
        <button type="button" className="booking-reschedule-stop" onClick={this.handleStopReschedule}>
          Dejar de reprogramar
        </button>
      </div>
    )
  }

  /** Las props de BookingFilters, iguales en la columna y en la hoja. */
  getFiltersProps() {
    return {
      subjects: this.getFilterSubjects(),
      filters: this.state.filters,
      showFavorites: this.isStudent(),
      hasFilters: this.hasFilters(),
      onToggle: this.handleToggle,
      onChangeRange: this.handleChangeRange,
      onClearTeacher: this.handleClearTeacher,
      onClear: this.handleClear,
    }
  }

  renderResults(porFecha) {
    const { selectedIso, loading } = this.state
    return (
      <BookingResults
        date={fromISODate(selectedIso)}
        cards={porFecha[selectedIso] || []}
        loading={loading}
        filtered={this.hasFilters()}
        packs={this.getPacks()}
        favoriteIds={this.props.favoriteIds}
        favoriteError={this.props.favoriteError}
        onReservar={this.handleReservar}
        onFavoriteChange={this.props.onFavoriteChange}
        onFavoriteError={this.props.onFavoriteError}
      />
    )
  }

  renderDialog() {
    const { booking } = this.state
    if (!booking) return null
    return (
      <BookingDialog
        card={booking}
        rescheduleOf={this.state.rescheduling}
        packs={this.getPacks()}
        neuronasBalance={this.state.neuronasBalance}
        onClose={this.handleCloseDialog}
        onBooked={this.handleBooked}
      />
    )
  }

  /**
   * Los chips de arriba en el teléfono: el botón que abre la hoja y los
   * filtros de un toque (favoritos, modalidad, tipo). Una sola fila que se
   * desliza de costado, como los filtros de las apps de iOS.
   */
  renderQuickFilters() {
    const cuantos = countBookingFilters(this.state.filters)
    const { modalities, kinds, onlyFavorites } = this.state.filters
    // FILTRO: el chip de favoritos solo para un alumno logueado (regla de
    // pantalla; el backend igual responde favoritos solo a alumnos).

    return (
      <div className="booking-quick" role="group" aria-label="Filtros rápidos">
        <button
          type="button"
          className={`subject-chip booking-quick-open ${cuantos > 0 ? 'selected' : ''}`}
          onClick={this.handleOpenFilters}
          aria-label={cuantos > 0 ? `Filtros, ${cuantos} activos` : 'Filtros'}
        >
          <FilterIcon />
          Filtros
          {cuantos > 0 ? <span className="booking-quick-count">{cuantos}</span> : null}
        </button>
        {this.isStudent() ? (
          <button
            type="button"
            className={`subject-chip ${onlyFavorites ? 'selected' : ''}`}
            aria-pressed={onlyFavorites}
            onClick={this.handleToggle('onlyFavorites')}
          >
            <HeartIcon filled={onlyFavorites} />
            Favoritos
          </button>
        ) : null}
        {MODALITIES.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`subject-chip ${modalities.includes(item.key) ? 'selected' : ''}`}
            aria-pressed={modalities.includes(item.key)}
            onClick={this.handleToggle('modalities', item.key)}
          >
            {item.label}
          </button>
        ))}
        {QUICK_KINDS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`subject-chip ${kinds.includes(item.key) ? 'selected' : ''}`}
            aria-pressed={kinds.includes(item.key)}
            onClick={this.handleToggle('kinds', item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>
    )
  }

  renderFiltersSheet() {
    if (!this.state.filtersOpen) return null
    return (
      <Modal title="Filtros" onClose={this.handleCloseFilters}>
        <BookingFilters {...this.getFiltersProps()} inSheet />
        <div className="booking-sheet-foot">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={this.handleClear}
            disabled={!this.hasFilters()}
          >
            Limpiar
          </button>
          <button type="button" className="btn btn-primary" onClick={this.handleCloseFilters}>
            Listo
          </button>
        </div>
      </Modal>
    )
  }

  renderMobile() {
    const { selectedIso, loading } = this.state
    const porFecha = this.getFilteredByDate()
    // FILTRO: el buscador solo para alumnos (regla de pantalla, igual que en
    // la barra de NavBar).

    return (
      <div className="booking-board is-mobile">
        <div className="booking-mobile-head">
          <h1 className="large-title">{this.state.rescheduling ? 'Reprogramar' : 'Reservar'}</h1>
          {/* El buscador de la barra lateral, que en el teléfono vive acá:
              buscar es para reservar. */}
          {this.isStudent() ? <SearchBar /> : null}
          {this.renderQuickFilters()}
        </div>

        <MonthPane
          mobile
          compactTitle
          eventsByDate={this.getLessonsByDate()}
          freeByDate={this.getFreeByDate(porFecha)}
          selectedIso={selectedIso}
          loading={loading}
          markedLabel="hay horarios"
          onSelectDay={this.handleSelectDay}
          onRangeChange={this.handleRangeChange}
        >
          {this.renderBanner()}
        </MonthPane>

        {this.renderResults(porFecha)}
        {this.renderFiltersSheet()}
        {this.renderDialog()}
      </div>
    )
  }

  render() {
    if (this.props.mobile) return this.renderMobile()

    const { selectedIso, loading } = this.state
    const porFecha = this.getFilteredByDate()

    return (
      <div className="booking-board">
        <div className="booking-panes">
          <MonthPane
            eventsByDate={this.getLessonsByDate()}
            freeByDate={this.getFreeByDate(porFecha)}
            selectedIso={selectedIso}
            loading={loading}
            onSelectDay={this.handleSelectDay}
            onRangeChange={this.handleRangeChange}
          >
            {this.renderBanner()}
          </MonthPane>

          {/* Igual que en el calendario: va después en el DOM y el CSS lo manda
              a la izquierda, porque el calendario es el contenido principal.
              Adentro, los filtros arriba y los horarios del día abajo. */}
          <aside className="booking-aside">
            <BookingFilters {...this.getFiltersProps()} />

            {this.renderResults(porFecha)}
          </aside>
        </div>

        {this.renderDialog()}
      </div>
    )
  }
}

BookingBoard.defaultProps = {
  mobile: false,
}

// El tablero recibe `user` y no `viewRole`: la regla de "es alumno" sale de ahí.
export default withViewport(
  withFavorites(BookingBoard, { isStudent: (props) => props.user?.role === 'student' }),
)

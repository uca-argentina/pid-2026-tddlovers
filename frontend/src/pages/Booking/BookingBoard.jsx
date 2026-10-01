import { Component } from 'react'
import MonthPane from '../Calendar/MonthPane.jsx'
import BookingFilters from './BookingFilters.jsx'
import BookingResults from './BookingResults.jsx'
import BookingDialog from './BookingDialog.jsx'
import Banner from '../../components/Banner.jsx'
import { fetchAvailability, fetchClass, fetchMyLessons, fetchSubjects } from '../../api/client.js'
import { formatDayLong, fromISODate, toISODate } from '../../utils/calendar.js'
import {
  annotateClashes,
  filterCards,
  groupCardsByDate,
  resolveQuery,
} from '../../utils/booking.js'
import './BookingBoard.css'

// Cuando no hay nada que anotar, SIEMPRE el mismo objeto: lo que sale de acá
// baja hasta MonthPane y hasta las tarjetas.
const SIN_TARJETAS = { slots: null, myLessons: null, excludeId: null, cards: [] }

/**
 * La pantalla del alumno: buscar clases para reservar. A la derecha el
 * calendario del mes y a la izquierda las clases del día elegido, con los
 * filtros arriba.
 *
 * Una tarjeta es un horario que ofrece un docente un día: rango, modalidad y
 * cupo los fijó el docente; la materia (entre las que tarifó), la hora de
 * inicio y la duración las elige el alumno en el modal (o se suma a una
 * grupal ya armada). Lo reservado CON ESE DOCENTE ya no está (lo restó el
 * backend); lo que el alumno tiene con OTRO aparece como aviso gris, porque
 * el rato del docente sigue existiendo aunque este alumno no lo pueda tomar.
 *
 * Con ?reprogramar=<id> la misma pantalla sirve para reprogramar una clase
 * confirmada: se ven solo los horarios del mismo docente y la misma materia, y
 * el modal pide el cambio en vez de una reserva nueva.
 *
 * El `router` llega por props desde AvailabilityPage en vez de envolver esto
 * en otro withRouter: alcanza con un puente por ruta y así sigue siendo obvio
 * que los hooks viven en un solo archivo.
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
    // --- filtros ---
    dayKeys: [],
    subjectIds: [],
    modalities: [],
    kinds: [],
    fromTime: '',
    toTime: '',
    teacherQuery: '',
  }

  // Dos contadores y no uno: si un cambio de mes compartiera token con el
  // catálogo, cambiar de mes descartaría en silencio un fetchSubjects en
  // vuelo.
  rangeToken = 0

  subjectsToken = 0

  rescheduleToken = 0

  // Cache de un solo valor, igual que shortRunsCache en AvailabilityPage: la
  // clave es la IDENTIDAD de los dos arrays, que sirve porque solo cambian
  // cuando vuelve una respuesta. Sin esto, tocar un chip recalcularía las
  // superposiciones de los 42 días de la grilla.
  cardsCache = SIN_TARJETAS

  componentDidMount() {
    this.loadSubjects()
    this.applyQuery()
    this.loadReschedule()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.router.location.search !== this.props.router.location.search) {
      this.applyQuery()
      if (prevProps.router.searchParams.get('reprogramar') !== this.getRescheduleId()) {
        this.loadReschedule()
      }
    }
  }

  componentWillUnmount() {
    this.rangeToken += 1
    this.subjectsToken += 1
    this.rescheduleToken += 1
  }

  getRescheduleId() {
    return this.props.router.searchParams.get('reprogramar')
  }

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

  getQuery() {
    return this.props.router.searchParams.get('q') || ''
  }

  /**
   * Qué significa lo que se buscó arriba: si pega con una materia se comporta
   * como si se hubiera tocado ese chip, y si no es un pedazo de nombre de
   * docente. Se vuelve a correr cuando cambia la URL, no en cada render.
   */
  applyQuery() {
    const q = this.getQuery()
    if (!q) return

    const { subjectId, teacherQuery } = resolveQuery(q, this.state.subjects)
    this.setState({
      teacherQuery,
      subjectIds: subjectId ? [subjectId] : [],
    })
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

  loadSubjects = () => {
    const token = ++this.subjectsToken
    fetchSubjects()
      .then((subjects) => {
        if (token !== this.subjectsToken) return
        const lista = Array.isArray(subjects) ? subjects : []
        this.setState({ subjects: lista })
        // El catálogo llega después que la URL, así que recién acá se puede
        // saber si lo buscado era una materia.
        if (this.getQuery()) {
          const { subjectId, teacherQuery } = resolveQuery(this.getQuery(), lista)
          this.setState({ teacherQuery, subjectIds: subjectId ? [subjectId] : [] })
        }
      })
      .catch(() => {
        // El catálogo solo alimenta los chips: si falla, la pantalla sigue
        // andando sin el filtro por materia.
        if (token === this.subjectsToken) this.setState({ subjects: [] })
      })
  }

  loadRange = (from, to) => {
    const token = ++this.rangeToken
    this.setState({ loading: true, error: null })

    const pedidos = [fetchAvailability({ from, to })]
    // Sin usuario no hay clases propias: tampoco hay superposiciones.
    pedidos.push(this.props.user ? fetchMyLessons({ from, to }) : Promise.resolve([]))

    Promise.all(pedidos)
      .then(([slots, myLessons]) => {
        if (token !== this.rangeToken) return
        this.setState({
          slots: Array.isArray(slots) ? slots : [],
          myLessons: Array.isArray(myLessons) ? myLessons : [],
          loading: false,
        })
      })
      .catch((error) => {
        if (token !== this.rangeToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar los horarios.',
        })
      })
  }

  /**
   * Todas las tarjetas del rango, con las superposiciones ya anotadas.
   *
   * Al reprogramar, la clase vieja no cuenta como choque: se cancela en el
   * mismo momento en que se toma la nueva (así se la puede correr media hora).
   */
  getCards() {
    const { slots, myLessons, rescheduling } = this.state
    const excludeId = rescheduling ? String(rescheduling.id) : null
    const cache = this.cardsCache
    if (cache.slots !== slots || cache.myLessons !== myLessons || cache.excludeId !== excludeId) {
      const propias = excludeId
        ? myLessons.filter((lesson) => String(lesson.id) !== excludeId)
        : myLessons
      this.cardsCache = { slots, myLessons, excludeId, cards: annotateClashes(slots, propias) }
    }
    const cards = this.cardsCache.cards
    return rescheduling ? this.onlyForReschedule(cards, rescheduling) : cards
  }

  /**
   * Reprogramar es con el mismo docente y la misma materia: las tarjetas de
   * ese docente que la ofrecen, recortadas a esa materia (y a las grupales de
   * esa materia) para que el modal no ofrezca otra.
   */
  onlyForReschedule(cards, cls) {
    const materia = String(cls.subjectId)
    return cards
      .filter((card) => String(card.teacherId) === String(cls.teacherId))
      .map((card) => ({
        ...card,
        subjects: card.subjects.filter((subject) => String(subject.id) === materia),
        groups: card.groups.filter((group) => String(group.subjectId) === materia),
      }))
      .filter((card) => card.subjects.length > 0)
  }

  getFilters() {
    const { dayKeys, subjectIds, modalities, kinds, fromTime, toTime, teacherQuery } = this.state
    return { dayKeys, subjectIds, modalities, kinds, fromTime, toTime, teacherQuery }
  }

  hasFilters() {
    const { dayKeys, subjectIds, modalities, kinds, fromTime, toTime, teacherQuery } = this.state
    return (
      dayKeys.length > 0 ||
      subjectIds.length > 0 ||
      modalities.length > 0 ||
      kinds.length > 0 ||
      Boolean(fromTime) ||
      Boolean(toTime) ||
      Boolean(teacherQuery)
    )
  }

  getFilteredByDate() {
    return groupCardsByDate(filterCards(this.getCards(), this.getFilters()))
  }

  /**
   * El número verde de cada día. Es la cantidad de TARJETAS y respeta los
   * filtros, así que lo que dice el calendario es exactamente lo que se ve al
   * tocar ese día.
   */
  getFreeByDate(porFecha) {
    const counts = {}
    for (const [iso, cards] of Object.entries(porFecha)) {
      counts[iso] = cards.length
    }
    return counts
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

  /** Solo las materias que se pueden reservar en algún horario del rango cargado. */
  getFilterSubjects() {
    // Todo se normaliza a string: el id elegido puede venir de la URL (siempre
    // string) y el de las tarjetas del backend, y un Set compara con ===.
    const presentes = new Set()
    for (const card of this.getCards()) {
      for (const subject of card.subjects) presentes.add(String(subject.id))
    }
    // La elegida se agrega igual: si no, un chip seleccionado que se queda sin
    // resultados desaparecería y no habría forma de sacarlo.
    for (const id of this.state.subjectIds) presentes.add(String(id))
    return this.state.subjects.filter((subject) => presentes.has(String(subject.id)))
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

  handleToggleDay = (dayKey) => () => {
    this.dropQuery()
    this.setState((prev) => ({
      dayKeys: prev.dayKeys.includes(dayKey)
        ? prev.dayKeys.filter((key) => key !== dayKey)
        : [...prev.dayKeys, dayKey],
    }))
  }

  handleToggleSubject = (subjectId) => () => {
    this.dropQuery()
    this.setState((prev) => ({
      subjectIds: prev.subjectIds.includes(subjectId)
        ? prev.subjectIds.filter((id) => id !== subjectId)
        : [...prev.subjectIds, subjectId],
    }))
  }

  /** Mismo patrón para modalidad y tipo: prender o apagar una clave de la lista. */
  toggleIn(key, value) {
    this.dropQuery()
    this.setState((prev) => ({
      [key]: prev[key].includes(value)
        ? prev[key].filter((item) => item !== value)
        : [...prev[key], value],
    }))
  }

  handleToggleModality = (modality) => () => {
    this.toggleIn('modalities', modality)
  }

  handleToggleKind = (kind) => () => {
    this.toggleIn('kinds', kind)
  }

  /**
   * El slider manda las dos puntas juntas: no se puede mover una sin saber
   * dónde quedó la otra (se empujan entre sí).
   */
  handleChangeRange = (fromTime, toTime) => {
    this.dropQuery()
    this.setState({ fromTime, toTime })
  }

  handleClearTeacher = () => {
    this.dropQuery()
    this.setState({ teacherQuery: '' })
  }

  handleClear = () => {
    this.dropQuery()
    this.setState({
      dayKeys: [],
      subjectIds: [],
      modalities: [],
      kinds: [],
      fromTime: '',
      toTime: '',
      teacherQuery: '',
    })
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
   * puede pasar a chocar con tarjetas de otros docentes. Recalcular eso acá
   * sería repetir lo que ya hace el backend, y es una sola llamada.
   *
   * `booked` lo arma el modal con lo que hace falta para el cartel.
   */
  handleBooked = (booked) => {
    const { booking, from, to } = this.state
    this.setState({ booking: null, booked, selectedIso: booking.date, rescheduling: null })
    // La reprogramación terminó: la pantalla vuelve a ser la de reservar.
    if (booked.rescheduled) this.dropParam('reprogramar')
    if (from && to) this.loadRange(from, to)
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

  render() {
    const { selectedIso, loading, booking } = this.state
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
            <BookingFilters
              subjects={this.getFilterSubjects()}
              dayKeys={this.state.dayKeys}
              subjectIds={this.state.subjectIds}
              modalities={this.state.modalities}
              kinds={this.state.kinds}
              fromTime={this.state.fromTime}
              toTime={this.state.toTime}
              teacherQuery={this.state.teacherQuery}
              hasFilters={this.hasFilters()}
              onToggleDay={this.handleToggleDay}
              onToggleSubject={this.handleToggleSubject}
              onToggleModality={this.handleToggleModality}
              onToggleKind={this.handleToggleKind}
              onChangeRange={this.handleChangeRange}
              onClearTeacher={this.handleClearTeacher}
              onClear={this.handleClear}
            />

            <BookingResults
              date={fromISODate(selectedIso)}
              cards={porFecha[selectedIso] || []}
              loading={loading}
              filtered={this.hasFilters()}
              onReservar={this.handleReservar}
            />
          </aside>
        </div>

        {booking ? (
          <BookingDialog
            card={booking}
            rescheduleOf={this.state.rescheduling}
            onClose={this.handleCloseDialog}
            onBooked={this.handleBooked}
          />
        ) : null}
      </div>
    )
  }
}

export default BookingBoard

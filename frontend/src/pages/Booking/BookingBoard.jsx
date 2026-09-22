import { Component } from 'react'
import MonthPane from '../Calendar/MonthPane.jsx'
import BookingFilters from './BookingFilters.jsx'
import BookingResults from './BookingResults.jsx'
import BookingDialog from './BookingDialog.jsx'
import Banner from '../../components/Banner.jsx'
import { fetchAvailability, fetchMyLessons, fetchSubjects } from '../../api/client.js'
import { fromISODate, toISODate } from '../../utils/calendar.js'
import {
  annotateClashes,
  filterCards,
  groupCardsByDate,
  resolveQuery,
} from '../../utils/booking.js'
import './BookingBoard.css'

// Cuando no hay nada que anotar, SIEMPRE el mismo objeto: lo que sale de acá
// baja hasta MonthPane y hasta las tarjetas.
const SIN_TARJETAS = { slots: null, myLessons: null, cards: [] }

/**
 * La pantalla del alumno: buscar horarios libres para reservar. A la derecha
 * el calendario del mes y a la izquierda las clases del día elegido, con los
 * filtros arriba.
 *
 * Una tarjeta es un docente, una materia y un día: todos los tramos libres de
 * ese día van juntos. Los horarios que el alumno ya reservó CON ESE DOCENTE ya
 * no están (los restó el backend); los que tiene con OTRO aparecen como aviso
 * gris, porque el horario del docente sigue existiendo aunque este alumno no
 * lo pueda tomar.
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
    // --- filtros ---
    dayKeys: [],
    subjectIds: [],
    fromTime: '',
    toTime: '',
    teacherQuery: '',
  }

  // Dos contadores y no uno: si un cambio de mes compartiera token con el
  // catálogo, cambiar de mes descartaría en silencio un fetchSubjects en
  // vuelo.
  rangeToken = 0

  subjectsToken = 0

  // Cache de un solo valor, igual que shortRunsCache en AvailabilityPage: la
  // clave es la IDENTIDAD de los dos arrays, que sirve porque solo cambian
  // cuando vuelve una respuesta. Sin esto, tocar un chip recalcularía las
  // superposiciones de los 42 días de la grilla.
  cardsCache = SIN_TARJETAS

  componentDidMount() {
    this.loadSubjects()
    this.applyQuery()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.router.location.search !== this.props.router.location.search) {
      this.applyQuery()
    }
    if (prevProps.subjectId !== this.props.subjectId) {
      this.applySubjectFromRoute()
    }
  }

  componentWillUnmount() {
    this.rangeToken += 1
    this.subjectsToken += 1
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
    if (!q) {
      this.applySubjectFromRoute()
      return
    }

    const { subjectId, teacherQuery } = resolveQuery(q, this.state.subjects)
    this.setState({
      teacherQuery,
      subjectIds: subjectId ? [subjectId] : [],
    })
  }

  /** /disponibilidad/:materiaId deja esa materia ya elegida. */
  applySubjectFromRoute() {
    const { subjectId } = this.props
    if (subjectId) this.setState({ subjectIds: [subjectId] })
  }

  /**
   * El `q` es una forma de ENTRAR con algo filtrado, no un filtro que se
   * queda: apenas el alumno toca cualquier chip a mano, se va de la URL. Con
   * replace, así el botón de atrás sigue sirviendo para volver de pantalla.
   */
  dropQuery() {
    if (!this.getQuery()) return
    this.props.router.setSearchParams({}, { replace: true })
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

  /** Todas las tarjetas del rango, con las superposiciones ya anotadas. */
  getCards() {
    const { slots, myLessons } = this.state
    if (this.cardsCache.slots !== slots || this.cardsCache.myLessons !== myLessons) {
      this.cardsCache = { slots, myLessons, cards: annotateClashes(slots, myLessons) }
    }
    return this.cardsCache.cards
  }

  getFilters() {
    const { dayKeys, subjectIds, fromTime, toTime, teacherQuery } = this.state
    return { dayKeys, subjectIds, fromTime, toTime, teacherQuery }
  }

  hasFilters() {
    const { dayKeys, subjectIds, fromTime, toTime, teacherQuery } = this.state
    return (
      dayKeys.length > 0 ||
      subjectIds.length > 0 ||
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

  /** Solo las materias que de verdad aparecen en el rango cargado. */
  getFilterSubjects() {
    // Todo se normaliza a string: el id elegido puede venir de la URL (siempre
    // string) y el de las tarjetas del backend, y un Set compara con ===.
    const presentes = new Set(this.getCards().map((card) => String(card.subjectId)))
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
    this.setState({ dayKeys: [], subjectIds: [], fromTime: '', toTime: '', teacherQuery: '' })
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
   * desaparece de todas las materias de ese docente y puede pasar a chocar con
   * tarjetas de otros. Recalcular eso acá sería repetir lo que ya hace el
   * backend, y es una sola llamada.
   */
  handleBooked = () => {
    const { booking, from, to } = this.state
    this.setState({ booking: null, booked: booking, selectedIso: booking.date })
    if (from && to) this.loadRange(from, to)
  }

  renderBanner() {
    const { error, booked } = this.state
    if (error) return <Banner type="danger">{error}</Banner>
    if (booked) {
      return (
        <Banner type="success">
          Reservaste {booked.subjectName} con {booked.teacherName}. Ya la ves en tu calendario.
        </Banner>
      )
    }
    return null
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
              fromTime={this.state.fromTime}
              toTime={this.state.toTime}
              teacherQuery={this.state.teacherQuery}
              hasFilters={this.hasFilters()}
              onToggleDay={this.handleToggleDay}
              onToggleSubject={this.handleToggleSubject}
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
            myLessons={this.state.myLessons}
            onClose={this.handleCloseDialog}
            onBooked={this.handleBooked}
          />
        ) : null}
      </div>
    )
  }
}

export default BookingBoard

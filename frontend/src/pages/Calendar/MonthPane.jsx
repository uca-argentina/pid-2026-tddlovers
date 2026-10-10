import { Component, createRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import MonthHeader from './MonthHeader.jsx'
import MonthGrid from './MonthGrid.jsx'
import WeekStrip from '../../components/WeekStrip.jsx'
import withViewport from '../../routes/withViewport.jsx'
import {
  addDays,
  addMonths,
  buildMonthGrid,
  formatMonthName,
  formatMonthTitle,
  fromISODate,
  startOfMonth,
  toISODate,
} from '../../utils/calendar.js'
import { startOfWeek, weekDates } from '../../utils/windows.js'
import './MonthPane.css'

// Mismo patrón que RegisterPage pero con menos desplazamiento: acá se mueve
// una grilla entera, no una tarjeta, y 60px se sentía exagerado.
const slideVariants = {
  enter: (direction) => ({ x: direction > 0 ? 40 : -40, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (direction) => ({ x: direction > 0 ? -40 : 40, opacity: 0 }),
}

// Cuántas clases mostrar por celda antes de poder medir de verdad (y en
// jsdom, donde no hay layout y todo mide 0).
const DEFAULT_VISIBLE_EVENTS = 3
const FALLBACK_LINE_HEIGHT = 19

/**
 * El calendario del mes, sin saber de dónde salen los datos: el encabezado con
 * las flechas, la grilla y la animación al cambiar de mes.
 *
 * Existe porque lo usan dos pantallas (mis clases y reservar), y sobre todo
 * por measureVisibleEvents: es el código más frágil de la app —lee una
 * variable CSS con getComputedStyle, escucha resize, y --day-event-line cambia
 * de valor en el breakpoint de 600px—, así que dos copias se iban a
 * desincronizar la primera vez que alguien tocara la vista de teléfono.
 *
 * Lo que NO se lleva es el fetch: el contrato para afuera es onRangeChange, y
 * así el guard de respuestas viejas (fetchToken) se queda al lado del pedido
 * que protege. `selectedIso` también queda afuera porque lo comparten los dos
 * paneles de cada pantalla.
 *
 * En el teléfono (`mobile`, de withViewport) no se ve el mes sino la tira de
 * semana del día elegido, como el Calendario de iOS; el botón "Mes" despliega
 * la grilla. El mes cargado sigue al día elegido (showMonthOf), así la semana
 * de la tira siempre cae dentro del rango que se le pidió al backend.
 */
class MonthPane extends Component {
  state = {
    viewDate: startOfMonth(new Date().getFullYear(), new Date().getMonth()),
    direction: 1,
    maxVisibleEvents: DEFAULT_VISIBLE_EVENTS,
    // Solo en el teléfono: si la grilla del mes está desplegada.
    expanded: false,
  }

  gridRef = createRef()

  componentDidMount() {
    this.emitRange()
    this.measureVisibleEvents()
    window.addEventListener('resize', this.measureVisibleEvents)
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.viewDate !== this.state.viewDate) {
      this.emitRange()
    }
    // Las celdas cambian de alto cuando aparece el cartel de error o cuando el
    // navegador termina de acomodar la grilla.
    this.measureVisibleEvents()
  }

  componentWillUnmount() {
    window.removeEventListener('resize', this.measureVisibleEvents)
  }

  getWeeks() {
    const { viewDate } = this.state
    return buildMonthGrid(viewDate.getFullYear(), viewDate.getMonth())
  }

  /** El rango que abarca la grilla, que es lo que hay que pedirle al backend. */
  emitRange() {
    const weeks = this.getWeeks()
    this.props.onRangeChange(weeks[0][0].iso, weeks[weeks.length - 1][6].iso)
  }

  /**
   * El alto de una celda vive en el CSS (--day-event-line, redefinido por
   * breakpoint) y se lee de vuelta acá para saber cuántas líneas entran. En
   * jsdom todo mide 0, así que ahí manda el valor por defecto.
   */
  measureVisibleEvents = () => {
    const node = this.gridRef.current
    if (!node) return

    const container = node.querySelector('[data-cell-events]')
    if (!container) return

    const available = container.clientHeight
    if (available <= 0) return

    const declared = getComputedStyle(node).getPropertyValue('--day-event-line')
    const lineHeight = parseFloat(declared) || FALLBACK_LINE_HEIGHT
    const max = Math.max(Math.floor(available / lineHeight), 0)

    if (max !== this.state.maxVisibleEvents) {
      this.setState({ maxVisibleEvents: max })
    }
  }

  handlePrevMonth = () => {
    this.setState((prev) => ({ viewDate: addMonths(prev.viewDate, -1), direction: -1 }))
  }

  handleNextMonth = () => {
    this.setState((prev) => ({ viewDate: addMonths(prev.viewDate, 1), direction: 1 }))
  }

  handleToday = () => {
    const today = new Date()
    this.setState((prev) => {
      const viewDate = startOfMonth(today.getFullYear(), today.getMonth())
      return {
        // Se conserva la identidad del objeto si no cambió el mes: así
        // componentDidUpdate no vuelve a pedir los datos al pedo.
        viewDate: viewDate.getTime() === prev.viewDate.getTime() ? prev.viewDate : viewDate,
        direction: viewDate < prev.viewDate ? -1 : 1,
      }
    })
    this.props.onSelectDay(toISODate(today))
  }

  handleSelectDay = (iso) => () => {
    this.props.onSelectDay(iso)
    // En el teléfono, elegir un día en la grilla vuelve a la tira, como en
    // iOS: lo que se quiere ver es ese día.
    if (this.props.mobile && this.state.expanded) {
      this.showMonthOf(iso)
      this.setState({ expanded: false })
    }
  }

  /** Lleva la grilla (y el rango pedido) al mes de ese día, si no está ahí. */
  showMonthOf(iso) {
    const date = fromISODate(iso)
    const target = startOfMonth(date.getFullYear(), date.getMonth())
    this.setState((prev) =>
      target.getTime() === prev.viewDate.getTime()
        ? null
        : { viewDate: target, direction: target < prev.viewDate ? -1 : 1 },
    )
  }

  selectFromStrip = (iso) => {
    this.props.onSelectDay(iso)
    this.showMonthOf(iso)
  }

  /** Las flechas de la tira: de a una semana, o de a un mes si está desplegada. */
  handleStripPrev = () => {
    if (this.state.expanded) this.handlePrevMonth()
    else this.selectFromStrip(toISODate(addDays(fromISODate(this.props.selectedIso), -7)))
  }

  handleStripNext = () => {
    if (this.state.expanded) this.handleNextMonth()
    else this.selectFromStrip(toISODate(addDays(fromISODate(this.props.selectedIso), 7)))
  }

  handleToggleExpanded = () => {
    // Al desplegar, el mes que se ve es el del día elegido.
    if (!this.state.expanded) this.showMonthOf(this.props.selectedIso)
    this.setState((prev) => ({ expanded: !prev.expanded }))
  }

  /** Los siete días de la semana del día elegido, para la tira. */
  getStripDays() {
    const { eventsByDate, freeByDate, selectedIso } = this.props
    const hoy = toISODate(new Date())
    return weekDates(startOfWeek(fromISODate(selectedIso))).map((date) => {
      const iso = toISODate(date)
      const libres = freeByDate[iso] || 0
      const propias = (eventsByDate[iso] || []).length
      return {
        iso,
        date,
        isToday: iso === hoy,
        marked: libres > 0 || propias > 0,
        // Verde si hay algo para reservar, azul si solo hay clases propias:
        // los mismos colores que la grilla.
        tone: libres > 0 ? 'free' : 'event',
      }
    })
  }

  renderGrid() {
    const { eventsByDate, freeByDate, selectedIso } = this.props
    const { viewDate, direction, maxVisibleEvents } = this.state

    return (
      <div className="month-pane-viewport">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={viewDate.getTime()}
            className="month-pane-slide"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.2, ease: 'easeInOut' }}
          >
            <MonthGrid
              weeks={this.getWeeks()}
              classesByDate={eventsByDate}
              freeByDate={freeByDate}
              selectedIso={selectedIso}
              onSelectDay={this.handleSelectDay}
              maxVisibleEvents={maxVisibleEvents}
              gridRef={this.gridRef}
            />
          </motion.div>
        </AnimatePresence>
      </div>
    )
  }

  renderMobile() {
    const { selectedIso, loading, children } = this.props
    const { expanded, viewDate } = this.state
    const titulo = expanded ? viewDate : fromISODate(selectedIso)

    return (
      <section className="month-pane is-mobile">
        <WeekStrip
          heading="h1"
          title={formatMonthName(titulo)}
          year={titulo.getFullYear()}
          compact={this.props.compactTitle}
          loading={loading}
          days={this.getStripDays()}
          selectedIso={selectedIso}
          markedLabel={this.props.markedLabel}
          expandable
          expanded={expanded}
          prevLabel={expanded ? 'Mes anterior' : 'Semana anterior'}
          nextLabel={expanded ? 'Mes siguiente' : 'Semana siguiente'}
          todayDisabled={!expanded && selectedIso === toISODate(new Date())}
          onSelect={this.selectFromStrip}
          onPrev={this.handleStripPrev}
          onNext={this.handleStripNext}
          onToday={this.handleToday}
          onToggleExpanded={this.handleToggleExpanded}
        >
          {this.renderGrid()}
        </WeekStrip>
        {children}
      </section>
    )
  }

  render() {
    if (this.props.mobile) return this.renderMobile()

    const { loading, children } = this.props
    const { viewDate } = this.state

    return (
      <section className="month-pane">
        <MonthHeader
          title={formatMonthTitle(viewDate)}
          loading={loading}
          onPrev={this.handlePrevMonth}
          onNext={this.handleNextMonth}
          onToday={this.handleToday}
        />
        {children}
        {this.renderGrid()}
      </section>
    )
  }
}

MonthPane.defaultProps = {
  eventsByDate: {},
  freeByDate: {},
  loading: false,
  mobile: false,
  // Cómo se lee un puntito de la tira en un lector de pantalla.
  markedLabel: 'hay clases',
  // En el teléfono, el mes más chico: para cuando la pantalla ya tiene su
  // propio título grande (Reservar).
  compactTitle: false,
}

export default withViewport(MonthPane)

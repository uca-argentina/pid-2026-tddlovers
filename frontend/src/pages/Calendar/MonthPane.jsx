import { Component, createRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import MonthHeader from './MonthHeader.jsx'
import MonthGrid from './MonthGrid.jsx'
import {
  addMonths,
  buildMonthGrid,
  formatMonthTitle,
  startOfMonth,
  toISODate,
} from '../../utils/calendar.js'
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
 */
class MonthPane extends Component {
  state = {
    viewDate: startOfMonth(new Date().getFullYear(), new Date().getMonth()),
    direction: 1,
    maxVisibleEvents: DEFAULT_VISIBLE_EVENTS,
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
  }

  render() {
    const { eventsByDate, freeByDate, selectedIso, loading, children } = this.props
    const { viewDate, direction, maxVisibleEvents } = this.state

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
      </section>
    )
  }
}

MonthPane.defaultProps = {
  eventsByDate: {},
  freeByDate: {},
  loading: false,
}

export default MonthPane

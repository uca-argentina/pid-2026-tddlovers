import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import MonthPane from './MonthPane.jsx'
import DayAgenda from './DayAgenda.jsx'
import { fromISODate, toISODate } from '../../utils/calendar.js'
import { fetchClasses } from '../../api/client.js'
import './CalendarPage.css'

// Esta pantalla es "mis clases": solo las reservadas/confirmadas. Los turnos
// libres son de la pantalla de disponibilidad, no de acá.
const CALENDAR_STATUS = 'reservada'

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
 */
class CalendarPage extends Component {
  state = {
    selectedIso: toISODate(new Date()),
    // El rango lo decide MonthPane y llega por onRangeChange.
    from: null,
    to: null,
    classes: [],
    classesLoading: false,
    classesError: null,
  }

  // Contador para descartar respuestas viejas: si se cambia de mes mientras
  // una request está en vuelo, la que llega tarde no tiene que pisar el
  // estado. También neutraliza el doble montaje que hace <StrictMode> en
  // desarrollo.
  fetchToken = 0

  componentWillUnmount() {
    this.fetchToken += 1
  }

  /** Las clases agrupadas por fecha ISO, cada lista ordenada por hora. */
  getClassesByDate() {
    const map = {}

    for (const item of this.state.classes) {
      // Se las pedimos al backend con ?status=reservada, pero mientras el
      // endpoint no exista no queremos depender de que respete el filtro: un
      // turno libre acá se leería como una clase que nadie reservó.
      if (item.status && item.status !== CALENDAR_STATUS) continue
      if (!map[item.date]) map[item.date] = []
      map[item.date].push(item)
    }

    // Las clases duran 1 h y arrancan :00 o :30, así que comparar los
    // strings 'HH:MM' alcanza para ordenarlas.
    for (const iso of Object.keys(map)) {
      map[iso].sort((a, b) => a.startTime.localeCompare(b.startTime))
    }

    return map
  }

  /** MonthPane avisa qué rango abarca la grilla; recién ahí se pide. */
  handleRangeChange = (from, to) => {
    this.setState({ from, to })
    this.loadClasses(from, to)
  }

  loadClasses = (from, to) => {
    const token = ++this.fetchToken

    this.setState({ classesLoading: true, classesError: null })
    fetchClasses({ from, to, status: CALENDAR_STATUS })
      .then((classes) => {
        if (token !== this.fetchToken) return
        // Defensivo: si el backend devuelve algo que no es un array,
        // preferimos una lista vacía a romper el render de la grilla.
        this.setState({
          classes: Array.isArray(classes) ? classes : [],
          classesLoading: false,
        })
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
          {classesError ? <Banner type="danger">{classesError}</Banner> : null}
        </MonthPane>

        {/* Va después en el DOM pero se dibuja a la izquierda (order en el
            CSS): el calendario es el contenido principal y el detalle es
            complementario. En pantallas chicas se apilan en el orden del
            DOM, que es el que conviene ahí. */}
        <aside className="calendar-aside">
          <DayAgenda
            date={fromISODate(selectedIso)}
            classes={classesByDate[selectedIso] || []}
            loading={classesLoading}
            viewRole={this.props.viewRole}
          />
        </aside>
      </div>
    )
  }
}

export default CalendarPage

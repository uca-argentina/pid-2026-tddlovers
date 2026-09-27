import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import MonthPane from './MonthPane.jsx'
import DayAgenda from './DayAgenda.jsx'
import { addDays, fromISODate, toISODate } from '../../utils/calendar.js'
import { fetchClasses } from '../../api/client.js'
import './CalendarPage.css'

// Esta pantalla es "mis clases": todo lo que sigue en pie, en cualquier
// estado (pendiente, aceptada, confirmada, realizada, no presentada). Las
// canceladas no ocupan lugar en el calendario: se ven en "Mis reservas".
const isOnCalendar = (item) => Boolean(item.status) && item.status !== 'cancelada'

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

  componentWillUnmount() {
    this.fetchToken += 1
    this.pendingToken += 1
  }

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
        const lista = Array.isArray(pendientes) ? pendientes : []
        // Defensivo, igual que el calendario: no depender de que el backend
        // respete el filtro.
        this.setState({ pendingCount: lista.filter((item) => item.status === 'pendiente').length })
      })
      .catch(() => {
        // El aviso es un extra: si falla, el calendario sigue andando.
      })
  }

  /**
   * Las clases agrupadas por fecha ISO, cada lista ordenada por hora.
   *
   * Una grupal llega como una fila por alumno (así está en la base), pero es
   * UNA clase: el docente la ve una sola vez con todos sus alumnos en
   * `students`. Cada alumno sigue teniendo su propia reserva, con su estado,
   * y esas filas van en `rows`: el docente acepta y toma lista de a uno. Al
   * alumno nunca le llegan dos filas del mismo turno, así que para él no
   * cambia nada.
   */
  getClassesByDate() {
    const map = {}
    const porTurno = {}

    for (const item of this.state.classes) {
      if (!isOnCalendar(item)) continue

      const turno = `${item.teacherId}|${item.date}|${item.startTime}`
      if (porTurno[turno]) {
        porTurno[turno].students.push(item.studentName)
        porTurno[turno].rows.push(item)
        continue
      }

      const clase = { ...item, students: [item.studentName], rows: [item] }
      porTurno[turno] = clase
      if (!map[item.date]) map[item.date] = []
      map[item.date].push(clase)
    }

    // Todo arranca :00 o :30, así que comparar los strings 'HH:MM' alcanza
    // para ordenarlas.
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
    fetchClasses({ from, to })
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

  /**
   * Una reserva cambió de estado (la aceptó, la pagó, la canceló): se
   * reemplaza esa fila y listo, no hace falta volver a pedir el mes. Si quedó
   * cancelada, getClassesByDate ya no la muestra.
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
          <DayAgenda
            date={fromISODate(selectedIso)}
            classes={classesByDate[selectedIso] || []}
            loading={classesLoading}
            viewRole={this.props.viewRole}
            onClassChange={this.handleClassChange}
          />
        </aside>
      </div>
    )
  }
}

export default CalendarPage

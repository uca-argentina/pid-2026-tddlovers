import { Component } from 'react'
import {
  slotIndexToTime,
  SLOTS_PER_CLASS,
  SLOTS_PER_DAY,
  timeToSlotIndex,
} from '../../utils/availability.js'
import { startOptions } from '../../utils/booking.js'
import './HourTimeline.css'

// Cuánto se muestra antes y después de las horas del docente.
const PADDING_SLOTS = 2
// Hasta esta cantidad de medias horas se marca cada hora; de ahí en más, cada
// dos, porque las etiquetas se empiezan a tocar.
const DENSE_TICKS_MAX = 16

/** { from, to } en índices de media hora, o null si el tramo no sirve. */
function spanOf(start, end) {
  const from = timeToSlotIndex(start)
  const to = timeToSlotIndex(end)
  if (from < 0 || to < 0 || to <= from) return null
  return { from, to }
}

/**
 * La línea de horas del día, tipo diagrama de Gantt de una sola fila: un
 * carril donde cada tramo es una barra redondeada, porque lo que importa es de
 * cuándo a cuándo va cada cosa y no cada media hora suelta.
 *
 * Los colores dicen qué se puede hacer con cada rato:
 *   verde  el docente está libre
 *   gris   el alumno ya tiene otra clase ahí (con cualquier docente)
 *   vacío  el docente no da clase a esa hora
 *   azul   lo elegido, y en un azul más suave lo que se está señalando
 *
 * La selección SIEMPRE dura una hora: se elige el arranque y se pinta la barra
 * de las dos medias horas. Solo se puede arrancar donde entre la clase entera.
 *
 * Son DOS capas encima del mismo carril: abajo las barras, que son solo
 * dibujo, y arriba botones transparentes de media hora que son los que se
 * tocan. Así el dibujo puede juntar tramos en una sola barra sin perder el
 * hecho de que lo que se elige es una media hora concreta, que es lo que
 * entiende el teclado y un lector de pantalla.
 *
 * Se muestran las horas del docente con un rato antes y después, y no el día
 * entero: las 24 h dejaban la mitad de la línea vacía y cada media hora en
 * 11px. Con el recorte cada franja es varias veces más ancha, que es lo que
 * hace que se entienda de un vistazo y que se pueda tocar con el dedo.
 */
class HourTimeline extends Component {
  state = {
    hoverStart: null,
  }

  /** El tramo de día que se dibuja: lo del docente más un rato a cada lado. */
  getWindow() {
    const { ranges } = this.props
    // Sin horas no hay de dónde recortar. No pasa desde una tarjeta, que
    // siempre trae al menos un tramo, pero el componente no depende de eso.
    if (ranges.length === 0) return { fromIndex: 0, toIndex: SLOTS_PER_DAY }

    const inicios = ranges.map((range) => timeToSlotIndex(range.start))
    const finales = ranges.map((range) => timeToSlotIndex(range.end))
    return {
      fromIndex: Math.max(Math.min(...inicios) - PADDING_SLOTS, 0),
      toIndex: Math.min(Math.max(...finales) + PADDING_SLOTS, SLOTS_PER_DAY),
    }
  }

  /** Un Set con los índices donde puede arrancar la clase. */
  getStarts() {
    return new Set(startOptions(this.props.free))
  }

  /** Dónde va una barra, recortada a lo que se está mostrando. */
  placeSpan(span, win) {
    const from = Math.max(span.from, win.fromIndex)
    const to = Math.min(span.to, win.toIndex)
    if (to <= from) return null
    return { gridColumn: `${from - win.fromIndex + 1} / span ${to - from}` }
  }

  handleEnter = (index) => () => {
    this.setState({ hoverStart: index })
  }

  handleLeave = () => {
    this.setState({ hoverStart: null })
  }

  /** Las horas del docente. Van abajo de todo: el resto se dibuja encima. */
  renderFree(win) {
    return this.props.ranges.map((range) => {
      const span = spanOf(range.start, range.end)
      const place = span && this.placeSpan(span, win)
      if (!place) return null
      return <div key={`libre-${range.start}`} className="hour-bar is-free" style={place} />
    })
  }

  /**
   * Las clases que el alumno ya tiene, con el nombre adentro de la barra: el
   * gris sin nombre dice "no podés" y no dice por qué.
   *
   * Materia y docente van en dos renglones y en spans separados porque lo que
   * entra depende del ANCHO DE LA BARRA, no del de la pantalla: una clase de
   * 1 h son 128px en un monitor y 45px en un teléfono, y una de 2 h es el
   * doble. Quién se muestra lo decide el CSS con una container query sobre la
   * barra misma (ver HourTimeline.css).
   */
  renderBusy(win) {
    return this.props.busy.map((lesson) => {
      const span = spanOf(lesson.startTime, lesson.endTime)
      const place = span && this.placeSpan(span, win)
      if (!place) return null

      return (
        <div
          key={lesson.id || `ocupado-${lesson.startTime}`}
          className="hour-bar is-busy"
          style={place}
        >
          <span className="hour-bar-label">
            <span className="hour-bar-subject">{lesson.subjectName || 'Tu clase'}</span>
            {lesson.teacherName ? (
              <span className="hour-bar-teacher">{lesson.teacherName}</span>
            ) : null}
          </span>
        </div>
      )
    })
  }

  /**
   * Las dos barras azules. La elegida es azul lleno y lo que se está señalando
   * es el mismo azul pero translúcido, para que se vea que es una propuesta y
   * no lo que se va a reservar. Conviven a propósito: con una hora ya elegida,
   * pasar por otra tiene que seguir mostrando qué pasaría.
   */
  renderPreview(win) {
    const { value } = this.props
    const { hoverStart } = this.state
    const barras = []

    if (hoverStart !== null && hoverStart !== value) {
      const place = this.placeSpan({ from: hoverStart, to: hoverStart + SLOTS_PER_CLASS }, win)
      if (place) barras.push(<div key="hover" className="hour-bar is-hover" style={place} />)
    }

    if (value !== null) {
      const place = this.placeSpan({ from: value, to: value + SLOTS_PER_CLASS }, win)
      if (place) barras.push(<div key="elegida" className="hour-bar is-selected" style={place} />)
    }

    return barras
  }

  /** Los botones transparentes: media hora cada uno. */
  renderPicks(win) {
    const { value, onSelect } = this.props
    const starts = this.getStarts()
    const picks = []

    for (let index = win.fromIndex; index < win.toIndex; index++) {
      // El final se corta a medianoche: la última media hora no puede arrancar
      // una clase, y decir "23:30 a 24:30" sería mentir sobre un día que no
      // existe.
      const hora = slotIndexToTime(index)
      const fin = slotIndexToTime(Math.min(index + SLOTS_PER_CLASS, SLOTS_PER_DAY))
      const puedeArrancar = starts.has(index)

      picks.push(
        <button
          key={index}
          type="button"
          className="hour-pick"
          disabled={!puedeArrancar}
          aria-pressed={value === index}
          aria-label={`${hora} a ${fin}`}
          onClick={() => onSelect(index)}
          // Solo donde se puede reservar: señalar una hora que no se puede
          // tomar no tiene ninguna propuesta que mostrar.
          onMouseEnter={puedeArrancar ? this.handleEnter(index) : undefined}
          onFocus={puedeArrancar ? this.handleEnter(index) : undefined}
        />,
      )
    }

    return picks
  }

  /** Las horas escritas arriba del carril. */
  renderTicks(win) {
    const ancho = win.toIndex - win.fromIndex
    const paso = ancho <= DENSE_TICKS_MAX ? 2 : 4
    const ticks = []

    for (let index = win.fromIndex; index < win.toIndex; index += paso) {
      ticks.push(
        <span
          key={index}
          className="hour-tick"
          style={{ gridColumn: `${index - win.fromIndex + 1} / span ${paso}` }}
        >
          {slotIndexToTime(index)}
        </span>,
      )
    }

    return ticks
  }

  render() {
    const win = this.getWindow()
    const columnas = `repeat(${win.toIndex - win.fromIndex}, minmax(0, 1fr))`

    return (
      <div className="hour-timeline" onMouseLeave={this.handleLeave}>
        <div className="hour-ticks" style={{ gridTemplateColumns: columnas }} aria-hidden="true">
          {this.renderTicks(win)}
        </div>

        <div className="hour-line">
          <div className="hour-bars" style={{ gridTemplateColumns: columnas }}>
            {this.renderFree(win)}
            {this.renderBusy(win)}
            {this.renderPreview(win)}
          </div>

          <div
            className="hour-picks"
            style={{ gridTemplateColumns: columnas }}
            role="group"
            aria-label="Elegí a qué hora arranca la clase"
          >
            {this.renderPicks(win)}
          </div>
        </div>

        <ul className="hour-legend">
          <li>
            <span className="hour-swatch is-free" aria-hidden="true" />
            Libre
          </li>
          <li>
            <span className="hour-swatch is-selected" aria-hidden="true" />
            Tu clase
          </li>
          {this.props.busy.length > 0 ? (
            <li>
              <span className="hour-swatch is-busy" aria-hidden="true" />
              Ya tenés clase
            </li>
          ) : null}
        </ul>
      </div>
    )
  }
}

HourTimeline.defaultProps = {
  ranges: [],
  free: [],
  busy: [],
  value: null,
}

export default HourTimeline

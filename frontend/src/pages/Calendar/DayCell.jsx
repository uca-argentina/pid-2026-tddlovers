import { Component } from 'react'
import { formatDayLong } from '../../utils/calendar.js'

/**
 * Una celda del calendario, al estilo del calendario de Apple: el número del
 * día arriba y abajo una línea por clase (hora + materia). Si no entran
 * todas, se muestran las que entran y una última línea "+N" con las que
 * quedaron afuera.
 *
 * Cuántas líneas entran no lo decide este componente: se lo pasa
 * CalendarPage en `maxVisible`, que mide el alto real de una celda (ver
 * measureVisibleEvents).
 *
 * Es un botón, así que va como clase y no como función (las funciones quedan
 * solo para los íconos SVG, que son pura presentación — ver icons.jsx). El
 * precedente exacto es RoleCard: sin estado propio, pero con onClick.
 *
 * Los estilos están en MonthGrid.css, no en un DayCell.css: fuera de la
 * grilla no significan nada.
 */
class DayCell extends Component {
  /**
   * Qué clases se muestran y cuántas quedan escondidas. Ojo con el caso
   * borde: si sobra una sola, mostrarla igual sería más honesto que un "+1",
   * pero la línea del "+N" ocupa su propio renglón, así que hay que liberar
   * uno.
   */
  getSplit() {
    const { events, maxVisible, freeCount } = this.props

    // La línea verde de horarios libres no negocia: si hay, se lleva un
    // renglón ANTES de repartir el resto, porque en la pantalla del alumno es
    // el dato principal. El "+N" sigue hablando solo de las clases propias.
    const budget = Math.max(maxVisible - (freeCount > 0 ? 1 : 0), 0)

    if (events.length <= budget) {
      return { visible: events, hidden: 0 }
    }

    const shown = Math.max(budget - 1, 0)
    return { visible: events.slice(0, shown), hidden: events.length - shown }
  }

  getLabel() {
    const { cell, events, freeCount } = this.props
    const day = formatDayLong(cell.date)

    const base =
      events.length === 0
        ? `${day}, sin clases`
        : `${day}, ${events.length} ${events.length === 1 ? 'clase' : 'clases'}`

    if (freeCount === 0) return base
    return `${base}, ${freeCount} ${freeCount === 1 ? 'horario libre' : 'horarios libres'}`
  }

  render() {
    const { cell, selected, onSelect, freeCount } = this.props
    const { visible, hidden } = this.getSplit()
    const classNames = ['day-cell']
    if (!cell.inMonth) classNames.push('is-outside')
    if (cell.isToday) classNames.push('is-today')
    if (freeCount > 0) classNames.push('is-free')
    if (selected) classNames.push('is-selected')

    return (
      <button
        type="button"
        className={classNames.join(' ')}
        onClick={onSelect}
        aria-pressed={selected}
        aria-label={this.getLabel()}
      >
        <span className="day-cell-number">{cell.day}</span>
        <span className="day-cell-events" data-cell-events>
          {/* Va primero: es de lo que trata la pantalla del alumno, y en el
              teléfono encabeza la fila de puntitos. El número tiene su propio
              span porque abajo de 600px .day-event-title se esconde: así
              sobrevive el "3" y se pierde solo la palabra. */}
          {freeCount > 0 ? (
            <span className="day-event day-event-free">
              <span className="day-event-dot" />
              <span className="day-event-free-count">{freeCount}</span>
              <span className="day-event-title">libres</span>
            </span>
          ) : null}
          {visible.map((item) => (
            <span key={item.id} className="day-event">
              <span className="day-event-dot" />
              <span className="day-event-time">{item.startTime}</span>
              <span className="day-event-title">{item.subjectName}</span>
            </span>
          ))}
          {hidden > 0 ? <span className="day-event-more">+{hidden}</span> : null}
        </span>
      </button>
    )
  }
}

DayCell.defaultProps = {
  events: [],
  freeCount: 0,
  maxVisible: 3,
  selected: false,
}

export default DayCell

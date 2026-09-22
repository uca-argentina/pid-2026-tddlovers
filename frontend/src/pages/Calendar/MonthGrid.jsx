import { Component } from 'react'
import DayCell from './DayCell.jsx'
import { WEEKDAY_LABELS } from '../../utils/calendar.js'
import './MonthGrid.css'

/**
 * La grilla del mes: la fila de nombres de día más las 6 semanas de 7
 * celdas que arma buildMonthGrid(). No decide nada — recibe las semanas ya
 * calculadas y avisa para arriba cuando se toca un día.
 *
 * `gridRef` va al contenedor de las semanas para que CalendarPage pueda
 * medir el alto de una celda y calcular cuántas clases entran.
 */
class MonthGrid extends Component {
  render() {
    const { weeks, classesByDate, freeByDate, selectedIso, onSelectDay } = this.props
    const { maxVisibleEvents, gridRef } = this.props

    return (
      <div className="month-grid">
        <div className="month-grid-weekdays" aria-hidden="true">
          {WEEKDAY_LABELS.map((label) => (
            <span key={label} className="month-grid-weekday">
              {label}
            </span>
          ))}
        </div>
        <div className="month-grid-weeks" ref={gridRef}>
          {weeks.map((week) => (
            <div key={week[0].iso} className="month-grid-week">
              {week.map((cell) => (
                <DayCell
                  key={cell.iso}
                  cell={cell}
                  events={classesByDate[cell.iso] || []}
                  freeCount={freeByDate[cell.iso] || 0}
                  maxVisible={maxVisibleEvents}
                  selected={cell.iso === selectedIso}
                  onSelect={onSelectDay(cell.iso)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    )
  }
}

MonthGrid.defaultProps = {
  classesByDate: {},
  freeByDate: {},
}

export default MonthGrid

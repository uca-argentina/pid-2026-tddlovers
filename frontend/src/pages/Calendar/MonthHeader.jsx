import { Component } from 'react'
import { ChevronLeftIcon, ChevronRightIcon, SpinnerIcon } from '../../components/icons.jsx'
import './MonthHeader.css'

/**
 * Encabezado del calendario: el mes que se está viendo, las flechas para
 * moverse y el botón "Hoy". No tiene estado propio (todo viene por props,
 * igual que RoleCard), pero es una clase porque tiene comportamiento.
 * Los estilos viven en CalendarPage.css.
 */
class MonthHeader extends Component {
  render() {
    const { title, loading, onPrev, onNext, onToday } = this.props

    return (
      <div className="month-header">
        <h1 className="month-header-title">
          {title}
          {loading ? <SpinnerIcon className="spin" /> : null}
        </h1>
        <div className="month-header-nav">
          <button type="button" className="month-today-btn" onClick={onToday}>
            Hoy
          </button>
          <button
            type="button"
            className="month-nav-btn"
            onClick={onPrev}
            aria-label="Mes anterior"
          >
            <ChevronLeftIcon />
          </button>
          <button
            type="button"
            className="month-nav-btn"
            onClick={onNext}
            aria-label="Mes siguiente"
          >
            <ChevronRightIcon />
          </button>
        </div>
      </div>
    )
  }
}

MonthHeader.defaultProps = {
  loading: false,
}

export default MonthHeader

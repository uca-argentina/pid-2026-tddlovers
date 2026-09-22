import { Component } from 'react'
import './TimeRangeSlider.css'

// El slider se mueve de a una hora: 24 posiciones en vez de las 48 medias
// horas. Alcanza para acotar la búsqueda —las clases igual pueden arrancar
// :30, eso lo decide la disponibilidad del docente— y con 360px de ancho las
// manijas quedan mucho más fáciles de apuntar.
const MIN_HOUR = 0
const MAX_HOUR = 24

/** 9 → "09:00". La medianoche del final se escribe "24:00" (ver CLAUDE.md). */
function hourToTime(hour) {
  return `${String(hour).padStart(2, '0')}:00`
}

/** "13:30" → 13. Se redondea hacia abajo: el slider es por hora entera. */
function timeToHour(time) {
  if (!time) return null
  const [h] = time.split(':')
  return Number(h)
}

/**
 * Elegir el rango horario con dos manijas sobre una misma barra.
 *
 * Son dos <input type="range"> superpuestos y no un control propio: así el
 * teclado (flechas, Inicio/Fin), el anuncio del lector de pantalla y el gesto
 * táctil vienen del navegador en vez de tener que escribirlos. La barra
 * coloreada del medio es un div decorativo por detrás.
 *
 * Hacia afuera sigue hablando el mismo idioma que los <select> que reemplazó:
 * `fromTime`/`toTime` como "HH:MM", y string vacío cuando no hay límite (ver
 * rangeOffersStartBetween en utils/booking.js). El rango completo 0–24 se
 * reporta como "sin filtro", que es lo que el alumno espera al abrirlo por
 * primera vez o al arrastrar las manijas a los extremos.
 *
 * Las manijas se empujan entre sí y no se cruzan, así que nunca se puede
 * armar un rango invertido.
 */
class TimeRangeSlider extends Component {
  getFromHour() {
    const hour = timeToHour(this.props.fromTime)
    return hour === null ? MIN_HOUR : hour
  }

  getToHour() {
    const hour = timeToHour(this.props.toTime)
    return hour === null ? MAX_HOUR : hour
  }

  /**
   * Avisa el rango nuevo. Los extremos se mandan vacíos: "desde las 00:00" es
   * lo mismo que "sin límite", y dejarlo vacío hace que hasFilters() no
   * cuente un filtro que no filtra nada.
   */
  emit(fromHour, toHour) {
    this.props.onChange(
      fromHour === MIN_HOUR ? '' : hourToTime(fromHour),
      toHour === MAX_HOUR ? '' : hourToTime(toHour),
    )
  }

  handleFromChange = (event) => {
    const value = Number(event.target.value)
    // Nunca pasa a la manija de la derecha: como mucho la toca.
    const fromHour = Math.min(value, this.getToHour() - 1)
    this.emit(fromHour, this.getToHour())
  }

  handleToChange = (event) => {
    const value = Number(event.target.value)
    const toHour = Math.max(value, this.getFromHour() + 1)
    this.emit(this.getFromHour(), toHour)
  }

  render() {
    const fromHour = this.getFromHour()
    const toHour = this.getToHour()
    // Porcentajes para pintar el tramo elegido de la barra.
    const izquierda = (fromHour / MAX_HOUR) * 100
    const derecha = (toHour / MAX_HOUR) * 100

    return (
      <div className="time-range">
        <div className="time-range-value">
          {hourToTime(fromHour)} <span className="time-range-dash">–</span> {hourToTime(toHour)}
        </div>

        <div className="time-range-track">
          {/* Decorativos: la barra de fondo y el tramo elegido. Los inputs
              van encima, transparentes salvo sus manijas. */}
          <span className="time-range-rail" aria-hidden="true" />
          <span
            className="time-range-fill"
            aria-hidden="true"
            style={{ left: `${izquierda}%`, right: `${100 - derecha}%` }}
          />

          <input
            type="range"
            className="time-range-input"
            min={MIN_HOUR}
            max={MAX_HOUR}
            step={1}
            value={fromHour}
            onChange={this.handleFromChange}
            aria-label="Desde"
            aria-valuetext={hourToTime(fromHour)}
          />
          <input
            type="range"
            className="time-range-input"
            min={MIN_HOUR}
            max={MAX_HOUR}
            step={1}
            value={toHour}
            onChange={this.handleToChange}
            aria-label="Hasta"
            aria-valuetext={hourToTime(toHour)}
          />
        </div>
      </div>
    )
  }
}

TimeRangeSlider.defaultProps = {
  fromTime: '',
  toTime: '',
}

export default TimeRangeSlider

import { Component } from 'react'
import './TimeRangeSlider.css'

const DAY_MINUTES = 24 * 60

/** 570 → "09:30". La medianoche del final se escribe "24:00" (ver CLAUDE.md). */
function minutesToTime(minutes) {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "13:30" → 810. Vacío → null. */
function timeToMinutes(time) {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  return h * 60 + (m || 0)
}

/**
 * Elegir un rango horario con dos manijas sobre una misma barra. Lo usan dos
 * pantallas que quieren cosas un poco distintas:
 *
 *   - el filtro del alumno (pages/Booking): de a una hora, y el día entero
 *     cuenta como "sin filtro", así que las puntas se informan vacías;
 *   - el formulario de una clase del docente (pages/Availability): de a media
 *     hora, porque las ventanas pueden arrancar :30, y siempre con las dos
 *     horas escritas — ahí 00:00 y 24:00 son horas de verdad.
 *
 * Eso son `step` (en minutos) y `emptyAtEnds`. Los defaults son los del
 * filtro, que fue el primero.
 *
 * Son dos <input type="range"> superpuestos y no un control propio: así el
 * teclado (flechas, Inicio/Fin), el anuncio del lector de pantalla y el gesto
 * táctil vienen del navegador en vez de tener que escribirlos. La barra
 * coloreada del medio es un div decorativo por detrás. Los inputs trabajan en
 * pasos (0 … 24 h / step) y hacia afuera se habla en "HH:MM".
 *
 * Las manijas se empujan entre sí y no se cruzan: siempre queda al menos un
 * paso entre las dos, así que nunca se puede armar un rango invertido o vacío.
 */
class TimeRangeSlider extends Component {
  getMaxStep() {
    return DAY_MINUTES / this.props.step
  }

  getFromStep() {
    const minutes = timeToMinutes(this.props.fromTime)
    return minutes === null ? 0 : Math.floor(minutes / this.props.step)
  }

  getToStep() {
    const minutes = timeToMinutes(this.props.toTime)
    return minutes === null ? this.getMaxStep() : Math.ceil(minutes / this.props.step)
  }

  /**
   * Avisa el rango nuevo. Con `emptyAtEnds`, las puntas se mandan vacías:
   * "desde las 00:00" es lo mismo que "sin límite", y dejarlo vacío hace que
   * el tablero no cuente un filtro que no filtra nada.
   */
  emit(fromStep, toStep) {
    const { step, emptyAtEnds, onChange } = this.props
    const vaciar = (value, extremo) => emptyAtEnds && value === extremo
    onChange(
      vaciar(fromStep, 0) ? '' : minutesToTime(fromStep * step),
      vaciar(toStep, this.getMaxStep()) ? '' : minutesToTime(toStep * step),
    )
  }

  handleFromChange = (event) => {
    // Nunca pasa a la manija de la derecha: como mucho queda un paso antes.
    const fromStep = Math.min(Number(event.target.value), this.getToStep() - 1)
    this.emit(fromStep, this.getToStep())
  }

  handleToChange = (event) => {
    const toStep = Math.max(Number(event.target.value), this.getFromStep() + 1)
    this.emit(this.getFromStep(), toStep)
  }

  render() {
    const { step, disabled, fromLabel, toLabel } = this.props
    const maxStep = this.getMaxStep()
    const fromStep = this.getFromStep()
    const toStep = this.getToStep()
    const desde = minutesToTime(fromStep * step)
    const hasta = minutesToTime(toStep * step)
    // Porcentajes para pintar el tramo elegido de la barra.
    const izquierda = (fromStep / maxStep) * 100
    const derecha = (toStep / maxStep) * 100

    return (
      <div className={`time-range ${disabled ? 'is-disabled' : ''}`}>
        <div className="time-range-value">
          {desde} <span className="time-range-dash">–</span> {hasta}
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
            min={0}
            max={maxStep}
            step={1}
            value={fromStep}
            onChange={this.handleFromChange}
            disabled={disabled}
            aria-label={fromLabel}
            aria-valuetext={desde}
          />
          <input
            type="range"
            className="time-range-input"
            min={0}
            max={maxStep}
            step={1}
            value={toStep}
            onChange={this.handleToChange}
            disabled={disabled}
            aria-label={toLabel}
            aria-valuetext={hasta}
          />
        </div>
      </div>
    )
  }
}

TimeRangeSlider.defaultProps = {
  fromTime: '',
  toTime: '',
  step: 60,
  emptyAtEnds: true,
  disabled: false,
  fromLabel: 'Desde',
  toLabel: 'Hasta',
}

export default TimeRangeSlider

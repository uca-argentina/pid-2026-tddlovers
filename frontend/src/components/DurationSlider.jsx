import { Component } from 'react'
import './TimeRangeSlider.css'
import './DurationSlider.css'

/**
 * Elegir una cantidad (en la reserva, los minutos de la clase) con una sola
 * manija. Se ve igual que TimeRangeSlider, el del filtro, y por eso usa sus
 * clases: la barra, el tramo pintado y la manija son los mismos. Es otro
 * componente porque el de dos manijas habla en "HH:MM" sobre las 24 h, y acá
 * es un número entre `min` y `max`.
 *
 * Los textos llegan armados (`valueLabel`, `minLabel`, `maxLabel`): qué decir
 * de "90" depende de quién lo usa — en la reserva es "1 h 30 min" y hasta qué
 * hora llega.
 *
 * `id` va en el input para que un <label htmlFor> de afuera lo nombre.
 */
class DurationSlider extends Component {
  handleChange = (event) => {
    this.props.onChange(Number(event.target.value))
  }

  render() {
    const { id, value, min, max, step, disabled, valueLabel, minLabel, maxLabel } = this.props
    // Con una sola duración posible (min === max) la barra va llena: no hay
    // nada que elegir, pero se ve cuánto dura.
    const lleno = max > min ? ((value - min) / (max - min)) * 100 : 100

    return (
      <div className={`time-range ${disabled ? 'is-disabled' : ''}`}>
        <div className="time-range-value">{valueLabel}</div>

        <div className="time-range-track">
          <span className="time-range-rail" aria-hidden="true" />
          <span
            className="time-range-fill"
            aria-hidden="true"
            style={{ left: 0, right: `${100 - lleno}%` }}
          />

          <input
            id={id}
            type="range"
            className="time-range-input duration-slider-input"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={this.handleChange}
            disabled={disabled}
            aria-valuetext={valueLabel}
          />
        </div>

        <div className="duration-slider-ends" aria-hidden="true">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      </div>
    )
  }
}

DurationSlider.defaultProps = {
  step: 1,
  disabled: false,
  minLabel: '',
  maxLabel: '',
}

export default DurationSlider

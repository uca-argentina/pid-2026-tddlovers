import { Component } from 'react'
import { CheckIcon } from './icons.jsx'
import './ProgressSteps.css'

/** Indicador de pasos 1-2-3, con check en los ya completados. */
class ProgressSteps extends Component {
  render() {
    const { total, current } = this.props
    const steps = Array.from({ length: total }, (_, i) => i)

    return (
      <div className="progress-steps">
        {steps.map((step) => (
          <div key={step} style={{ display: 'flex', alignItems: 'center' }}>
            <div
              className={`progress-dot ${step < current ? 'done' : step === current ? 'active' : ''}`}
            >
              {step < current ? <CheckIcon /> : step + 1}
            </div>
            {step < steps.length - 1 && (
              <div className={`progress-line ${step < current ? 'done' : ''}`} />
            )}
          </div>
        ))}
      </div>
    )
  }
}

export default ProgressSteps

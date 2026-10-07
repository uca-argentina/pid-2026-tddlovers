import { Component } from 'react'
import { CheckIcon, ClockIcon, ErrorIcon } from './icons.jsx'

// warning es un aviso de espera (p. ej. el docente sin aprobar), no un error:
// por eso el reloj y no la cruz.
const ICONS = { success: CheckIcon, warning: ClockIcon, danger: ErrorIcon }

class Banner extends Component {
  render() {
    const { type = 'danger', children } = this.props
    const Icon = ICONS[type] || ErrorIcon

    return (
      <div className={`banner banner-${type}`} role={type === 'danger' ? 'alert' : 'status'}>
        <Icon />
        <span>{children}</span>
      </div>
    )
  }
}

export default Banner

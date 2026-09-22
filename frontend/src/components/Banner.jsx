import { Component } from 'react'
import { CheckIcon, ErrorIcon } from './icons.jsx'

class Banner extends Component {
  render() {
    const { type = 'danger', children } = this.props

    return (
      <div className={`banner banner-${type}`} role={type === 'danger' ? 'alert' : 'status'}>
        {type === 'danger' ? <ErrorIcon /> : <CheckIcon />}
        <span>{children}</span>
      </div>
    )
  }
}

export default Banner

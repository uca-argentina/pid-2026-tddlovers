import { Component } from 'react'
import { CheckIcon } from './icons.jsx'
import './RoleCard.css'

class RoleCard extends Component {
  render() {
    const { icon, title, subtitle, selected, onClick } = this.props

    return (
      <button
        type="button"
        className={`role-card ${selected ? 'selected' : ''}`}
        onClick={onClick}
        aria-pressed={selected}
      >
        <span className="role-card-icon">{icon}</span>
        <span>
          <span className="role-card-title" style={{ display: 'block' }}>
            {title}
          </span>
          <span className="role-card-subtitle">{subtitle}</span>
        </span>
        <span className="role-card-check">{selected && <CheckIcon />}</span>
      </button>
    )
  }
}

export default RoleCard

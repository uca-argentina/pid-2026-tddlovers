import { Component } from 'react'
import { CheckIcon, SearchIcon } from './icons.jsx'
import './SubjectPicker.css'

class SubjectPicker extends Component {
  state = {
    query: '',
  }

  handleQueryChange = (event) => {
    this.setState({ query: event.target.value })
  }

  getFilteredSubjects() {
    const { subjects } = this.props
    const q = this.state.query.trim().toLowerCase()
    if (!q) return subjects
    return subjects.filter((subject) => subject.name.toLowerCase().includes(q))
  }

  render() {
    const { selectedIds, onToggle } = this.props
    const filtered = this.getFilteredSubjects()

    return (
      <div>
        <div className="subject-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Buscar materia..."
            value={this.state.query}
            onChange={this.handleQueryChange}
          />
        </div>
        <div className="subject-list">
          {filtered.length === 0 && <p className="subject-empty">No se encontraron materias.</p>}
          {filtered.map((subject) => {
            const selected = selectedIds.includes(subject.id)
            return (
              <button
                type="button"
                key={subject.id}
                className={`subject-chip ${selected ? 'selected' : ''}`}
                onClick={() => onToggle(subject.id)}
                aria-pressed={selected}
              >
                {selected && <CheckIcon />}
                {subject.name}
              </button>
            )
          })}
        </div>
        <p className="subject-count">
          {selectedIds.length} materia{selectedIds.length === 1 ? '' : 's'} seleccionada
          {selectedIds.length === 1 ? '' : 's'}
        </p>
      </div>
    )
  }
}

export default SubjectPicker

import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import { SearchIcon } from '../../components/icons.jsx'
import { EMPTY_FILTERS, filterTurns, hasFilters, subjectsOf } from '../../utils/reservations.js'
import './CategoryDialog.css'

/**
 * La lista de una categoría de Mis reservas (Pendientes, Finalizadas...) en
 * una hoja alta, con filtros por materia, por fecha (desde / hasta, días) y
 * por nombre: el alumno busca a su docente y el docente a sus alumnos.
 *
 * Los filtros viven acá y no en la página: cada vez que se abre una
 * categoría arranca sin filtrar, que es lo que se espera al tocar la tarjeta.
 * Las materias del selector son solo las que aparecen en esa categoría.
 *
 * Las tarjetas las arma la página (renderCard), que es la que tiene las
 * reservas, los favoritos y el detalle.
 */
class CategoryDialog extends Component {
  state = { filters: EMPTY_FILTERS }

  handleFilter = (key) => (event) => {
    const { value } = event.target
    this.setState((prev) => ({ filters: { ...prev.filters, [key]: value } }))
  }

  handleClear = () => this.setState({ filters: EMPTY_FILTERS })

  renderFilters(subjects) {
    const { filters } = this.state
    const placeholder =
      this.props.viewRole === 'teacher' ? 'Buscar por alumno' : 'Buscar por docente'

    return (
      <div className="category-filters" role="search" aria-label="Filtrar clases">
        <label className="category-filter category-filter-name">
          <span>Nombre</span>
          <span className="category-filter-search">
            <SearchIcon />
            <input
              type="search"
              value={filters.name}
              placeholder={placeholder}
              aria-label={placeholder}
              onChange={this.handleFilter('name')}
            />
          </span>
        </label>
        <label className="category-filter">
          <span>Materia</span>
          <select value={filters.subjectId} onChange={this.handleFilter('subjectId')}>
            <option value="">Todas</option>
            {subjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </label>
        <label className="category-filter">
          <span>Desde</span>
          <input
            type="date"
            value={filters.from}
            max={filters.to || undefined}
            onChange={this.handleFilter('from')}
          />
        </label>
        <label className="category-filter">
          <span>Hasta</span>
          <input
            type="date"
            value={filters.to}
            min={filters.from || undefined}
            onChange={this.handleFilter('to')}
          />
        </label>
      </div>
    )
  }

  render() {
    const { category, turns, viewRole, renderCard, onClose } = this.props
    const { filters } = this.state
    const visibles = filterTurns(turns, filters, viewRole)
    const filtrando = hasFilters(filters)

    return (
      <Modal title={category.title} onClose={onClose} tall>
        {turns.length === 0 ? (
          <p className="reservations-empty">No hay clases {category.title.toLowerCase()}.</p>
        ) : (
          <>
            {this.renderFilters(subjectsOf(turns))}
            {filtrando ? (
              <div className="category-filter-status">
                <span>
                  {visibles.length} de {turns.length} {turns.length === 1 ? 'clase' : 'clases'}
                </span>
                <button type="button" className="category-filter-clear" onClick={this.handleClear}>
                  Limpiar filtros
                </button>
              </div>
            ) : null}
            {visibles.length === 0 ? (
              <p className="reservations-empty">Ninguna clase coincide con los filtros.</p>
            ) : (
              <ul className="reservations-list reservations-dialog-list">
                {visibles.map((turn) => renderCard(turn.cls))}
              </ul>
            )}
          </>
        )}
      </Modal>
    )
  }
}

CategoryDialog.defaultProps = {
  // Los turnos de la categoría, ya en su orden (turnsIn).
  turns: [],
  viewRole: 'student',
  renderCard: () => null,
  onClose: () => {},
}

export default CategoryDialog

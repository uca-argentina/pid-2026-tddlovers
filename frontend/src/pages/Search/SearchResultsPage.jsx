import { Component } from 'react'
import { SearchIcon } from '../../components/icons.jsx'
import './SearchResultsPage.css'

/**
 * Pantalla de /buscar, todavía sin contenido. El buscador de la barra ya
 * sugiere mientras se tipea y lleva a la pantalla de reservar (ver
 * components/SearchBar.jsx); esta ruta queda para una página de resultados
 * completa más adelante y existe para que /buscar no quede rota.
 */
class SearchResultsPage extends Component {
  render() {
    return (
      <div className="search-page">
        <div className="search-page-empty">
          <SearchIcon />
          <p>El buscador todavía está en construcción.</p>
          <p className="search-page-hint">
            Vas a poder buscar docentes por nombre o por materia.
          </p>
        </div>
      </div>
    )
  }
}

export default SearchResultsPage

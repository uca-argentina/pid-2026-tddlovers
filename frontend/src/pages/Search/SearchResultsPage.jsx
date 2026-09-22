import { Component } from 'react'
import { SearchIcon } from '../../components/icons.jsx'
import './SearchResultsPage.css'

/**
 * Destino del buscador. Todavía no muestra resultados: el input de la barra
 * superior es solo la cáscara visual (ver el TODO en components/SearchBar.jsx)
 * y el backend no tiene endpoint de búsqueda. Existe para que la ruta
 * /buscar no quede rota.
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

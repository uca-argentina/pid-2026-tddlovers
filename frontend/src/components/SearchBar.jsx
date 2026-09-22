import { Component } from 'react'
import withRouter from '../routes/withRouter.jsx'
import { SearchIcon } from './icons.jsx'
import './SearchBar.css'

/**
 * Buscador de la barra superior. Al enviar lleva a la pantalla de reservar
 * con lo buscado en la URL, donde se convierte en un filtro más (ver
 * pages/Booking/BookingBoard.jsx).
 *
 * Reusa la forma del buscador de materias de SubjectPicker (ícono a la
 * izquierda, input con padding para no taparlo), pero redondeado como
 * pastilla para que se lea como parte de la barra.
 */
class SearchBar extends Component {
  state = {
    query: '',
  }

  handleChange = (event) => {
    this.setState({ query: event.target.value })
  }

  handleSubmit = (event) => {
    event.preventDefault()
    const q = this.state.query.trim()

    // Se aplica al ENVIAR y no mientras se tipea: esta barra vive en todas las
    // pantallas, así que buscar por tecla te sacaría del calendario a la mitad
    // de una palabra y cada letra sería una entrada del historial.
    //
    // Lo buscado lo interpreta la pantalla de reservar: si es una materia
    // queda elegida como si se hubiera tocado el chip, y si no se toma como
    // nombre de docente (ver resolveQuery en utils/booking.js). La ruta
    // /buscar sigue existiendo para un buscador general más adelante.
    this.props.router.navigate(
      q ? `/disponibilidad?q=${encodeURIComponent(q)}` : '/disponibilidad',
    )
  }

  render() {
    return (
      <form className="search-bar" role="search" onSubmit={this.handleSubmit}>
        <SearchIcon />
        <input
          type="search"
          value={this.state.query}
          onChange={this.handleChange}
          placeholder="Buscar docentes o materias..."
          aria-label="Buscar docentes o materias"
        />
      </form>
    )
  }
}

export default withRouter(SearchBar)

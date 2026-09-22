import { Component } from 'react'
import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { CalendarIcon, ClockIcon, UserIcon } from './icons.jsx'
import './NavBar.css'

/**
 * Barra superior fija: perfil a la izquierda, buscador en el medio y, a la
 * derecha, los dos interruptores (tema y rol) más disponibilidad y
 * calendario. Se monta una sola vez desde AppLayout, así que navegar entre
 * pantallas no la remonta (el texto del buscador no se pierde).
 *
 * Usa <NavLink>, que es un componente común y no un hook, así que no hace
 * falta ningún puente para poder seguir siendo un class component. El
 * `className` de NavLink acepta una función: no es un hook, es una render
 * prop.
 */
class NavBar extends Component {
  getLinkClass = ({ isActive }) => `navbar-icon-btn ${isActive ? 'is-active' : ''}`

  render() {

    return (
      <header className="navbar">
        <nav className="navbar-inner">
          <NavLink to="/perfil" className={this.getLinkClass} aria-label="Mi perfil">
            <UserIcon />
          </NavLink>
          <ThemeToggle />
          <SearchBar />
          <NavLink to="/disponibilidad" className={this.getLinkClass} aria-label="Disponibilidad">
            <ClockIcon />
          </NavLink>
          {/* `end` para que "/" no quede activo en todas las rutas. */}
          <NavLink to="/" end className={this.getLinkClass} aria-label="Mi calendario">
            <CalendarIcon />
          </NavLink>
        </nav>
      </header>
    )
  }
}

NavBar.defaultProps = {
  viewRole: 'student',
}

export default NavBar

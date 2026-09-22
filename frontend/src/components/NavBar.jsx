import { Component } from 'react'
import { NavLink } from 'react-router-dom'
import SearchBar from './SearchBar.jsx'
import ThemeToggle from './ThemeToggle.jsx'
import { CalendarIcon, ClockIcon, UserIcon } from './icons.jsx'
import { getInitials } from '../utils/user.js'
import './NavBar.css'

/**
 * Barra lateral fija: la marca arriba, el buscador, los destinos de la app
 * con ícono y etiqueta, y abajo el interruptor de tema. Se monta una sola
 * vez desde AppLayout, así que navegar entre pantallas no la remonta (el
 * texto del buscador no se pierde).
 *
 * Es oscura en los dos temas (tokens --color-sidebar-*), como el diseño.
 *
 * En pantallas chicas el CSS la convierte en una barra horizontal abajo,
 * donde las etiquetas se esconden y quedan solo los íconos: el mismo markup
 * sirve para las dos formas, así que no hace falta medir el viewport.
 *
 * Usa <NavLink>, que es un componente común y no un hook, así que no hace
 * falta ningún puente para poder seguir siendo un class component. El
 * `className` de NavLink acepta una función: no es un hook, es una render
 * prop.
 */
class NavBar extends Component {
  getLinkClass = ({ isActive }) => `navbar-item ${isActive ? 'is-active' : ''}`

  render() {
    // La pantalla es la misma para los dos roles, pero lo que se va a hacer
    // ahí no: el docente carga los horarios que da y el alumno busca uno para
    // reservar. El aria-label sí queda igual para los dos.
    const esDocente = this.props.viewRole === 'teacher'
    const etiquetaDisponibilidad = esDocente ? 'Disponibilidad' : 'Reservar'
    // Sin sesión no hay nombre que mostrar (y el link lleva al cartel de
    // "iniciá sesión"), así que ahí se cae a la etiqueta genérica en vez de
    // dejar el renglón vacío. El apellido puede faltar: se arma con filter
    // para no terminar con un espacio colgando.
    const { user } = this.props
    const nombreCompleto = [user?.nombre, user?.apellido].filter(Boolean).join(' ')
    const etiquetaPerfil = nombreCompleto || 'Mi perfil'
    // Las mismas iniciales que el avatar del perfil. Si vienen vacías (sin
    // sesión) se dibuja el ícono genérico, que es lo único que se puede
    // mostrar cuando todavía no se sabe quién es.
    const iniciales = getInitials(user)

    return (
      <header className="navbar">
        {/* El buscador y la marca se esconden en la barra de abajo del
            teléfono; el buscador reaparece arriba del contenido. */}
        <div className="navbar-brand">
          <span className="navbar-brand-mark" aria-hidden="true">
            <CalendarIcon />
          </span>
          <span className="navbar-brand-name">BookIt</span>
          <ThemeToggle />
        </div>

        <div className="navbar-search">
          <SearchBar />
        </div>

        <nav className="navbar-nav">
          {/* `end` para que "/" no quede activo en todas las rutas. */}
          <NavLink to="/" end className={this.getLinkClass} aria-label="Mi calendario">
            <CalendarIcon />
            <span className="navbar-item-label">Calendario</span>
          </NavLink>
          <NavLink to="/disponibilidad" className={this.getLinkClass} aria-label="Disponibilidad">
            <ClockIcon />
            <span className="navbar-item-label">{etiquetaDisponibilidad}</span>
          </NavLink>
          
        </nav>

        <div className="navbar-foot">
          <NavLink to="/perfil" className={this.getLinkClass} aria-label="Mi perfil">
            {iniciales ? (
              <span className="navbar-avatar" aria-hidden="true">
                {iniciales}
              </span>
            ) : (
              <UserIcon />
            )}
            <span className="navbar-item-label">{etiquetaPerfil}</span>
          </NavLink>
        </div>
      </header>
    )
  }
}

NavBar.defaultProps = {
  viewRole: 'student',
}

export default NavBar

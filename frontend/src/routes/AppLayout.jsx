import { Component } from 'react'
import { Outlet } from 'react-router-dom'
import NavBar from '../components/NavBar.jsx'
import './AppLayout.css'

/**
 * Layout de las pantallas de adentro de la app: la barra superior fija más
 * el contenido de la ruta hija (<Outlet />). Al ser una ruta "sin path" que
 * envuelve a las demás, el NavBar se monta una sola vez y sobrevive a los
 * cambios de pantalla.
 *
 * No hace de portero: por ahora se puede entrar al calendario sin estar
 * logueado (no hay backend de sesión todavía, así que un candado sería de
 * mentira). Cada pantalla se arregla sola si `user` viene en null.
 *
 * Los hijos NO reciben datos por el Outlet — eso necesitaría el hook
 * useOutletContext. App se los pasa directo por props a cada ruta.
 *
 * A diferencia de .auth-page, acá no pisamos las variables de color: estas
 * pantallas siguen el modo claro/oscuro del sistema (ver el comentario en
 * styles/ui.css).
 */
class AppLayout extends Component {
  render() {
    const { viewRole, onToggleRole } = this.props

    return (
      <div className="app-shell">
        <NavBar viewRole={viewRole} onToggleRole={onToggleRole} />
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    )
  }
}

export default AppLayout

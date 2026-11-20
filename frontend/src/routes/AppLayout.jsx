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
 * No hace de portero: App no lo monta hasta que /api/auth/me contestó
 * (sessionChecked), pero si no hay sesión igual se muestra y no redirige a
 * /ingresar. Cada pantalla se arregla sola si `user` viene en null, y el
 * backend rechaza con 401 lo que necesita sesión.
 *
 * Los hijos NO reciben datos por el Outlet — eso necesitaría el hook
 * useOutletContext. App se los pasa directo por props a cada ruta.
 *
 * A diferencia de .auth-page, acá no pisamos las variables de color: estas
 * pantallas siguen el modo claro/oscuro del sistema (ver el comentario en
 * styles/ui.css).
 *
 * Props (de App.jsx): `viewRole` (roleOf(user)) y `user` (el de /api/auth/me,
 * o null); las dos van al NavBar, y viewRole decide si se deja lugar para el
 * buscador del alumno.
 */
class AppLayout extends Component {
  render() {
    const { viewRole, user } = this.props

    return (
      <div className="app-shell">
        <NavBar viewRole={viewRole} user={user} />
        {/* Sin buscador (solo lo tiene el alumno) no hace falta dejarle
            lugar arriba en el teléfono. */}
        <main className={`app-main ${viewRole === 'student' ? 'has-search' : ''}`}>
          <Outlet />
        </main>
      </div>
    )
  }
}

export default AppLayout

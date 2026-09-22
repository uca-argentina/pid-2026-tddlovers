import { Component } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './routes/AppLayout.jsx'
import AvailabilityPage from './pages/Availability/AvailabilityPage.jsx'
import CalendarPage from './pages/Calendar/CalendarPage.jsx'
import LoginPage from './pages/Login/LoginPage.jsx'
import ProfilePage from './pages/Profile/ProfilePage.jsx'
import RegisterPage from './pages/Register/RegisterPage.jsx'
import SearchResultsPage from './pages/Search/SearchResultsPage.jsx'
import { fetchCurrentUser, logoutAccount } from './api/client.js'

/**
 * Punto de montaje de la app, con rutas de verdad (react-router-dom). La
 * pantalla de entrada es el calendario.
 *
 * La sesión vive en una cookie httpOnly que pone el backend. Al montar se
 * pregunta por /api/auth/me: si hay sesión, se recupera el usuario y
 * refrescar no desloguea; si no, `user` queda en null y el perfil muestra el
 * cartel de "iniciá sesión".
 *
 * Todas las redirecciones se hacen con <Navigate> y todos los links con
 * <Link>/<NavLink>: son componentes comunes, no hooks, así que esto sigue
 * siendo un class component como el resto de la app.
 */
class App extends Component {
  state = {
    user: null,
    justRegisteredName: null,
    // Desde qué rol se está mirando la app. ANDAMIO DE PRUEBA: el botón de la
    // barra (RoleToggle) NO va a producción. Arranca en el rol del usuario que
    // se loguea; el día que se borre el botón, esto se reemplaza por user.role
    // y sale del estado.
    viewRole: 'student',
  }

  /**
   * Recupera la sesión al abrir la app. Un 401 es lo normal cuando no hay
   * nadie logueado, así que no se muestra ningún error: simplemente se queda
   * sin usuario.
   */
  componentDidMount() {
    fetchCurrentUser()
      .then((user) => {
        this.setState({ user, viewRole: user?.role === 'teacher' ? 'teacher' : 'student' })
      })
      .catch(() => {})
  }

  handleLoginSuccess = (user) => {
    this.setState({
      user,
      justRegisteredName: null,
      viewRole: user?.role === 'teacher' ? 'teacher' : 'student',
    })
  }

  handleRegisterComplete = (_result, nombre) => {
    this.setState({ justRegisteredName: nombre })
  }

  /**
   * App es el dueño de `user`, así que el perfil avisa para acá cuando
   * guarda. Sin esto, salir del perfil lo desmonta y al volver se vería el
   * dato viejo. No se toca `viewRole`: ese lo maneja el interruptor de la
   * barra, no lo que se guardó.
   */
  handleUserChange = (user) => {
    this.setState({ user })
  }

  /**
   * Cerrar sesión: se borra la cookie en el backend y se olvida el usuario
   * acá. El estado se limpia igual aunque el pedido falle — si no, la app
   * seguiría mostrando a alguien logueado que ya se quiso ir.
   *
   * La navegación al login la hace el <Link> del perfil.
   */
  handleLogout = () => {
    logoutAccount().catch(() => {})
    this.setState({ user: null, viewRole: 'student', justRegisteredName: null })
  }

  render() {
    const { user, justRegisteredName, viewRole } = this.state

    return (
      <BrowserRouter>
        <Routes>
          {/* Sin guardia de "ya está logueado": la redirección después de
              entrar la hace LoginPage con su propio <Navigate>, así /ingresar
              se puede visitar igual (hace falta ahora que la app arranca con
              un usuario de prueba ya cargado). */}
          <Route
            path="/ingresar"
            element={
              <LoginPage
                successMessage={
                  justRegisteredName
                    ? `¡Listo, ${justRegisteredName}! Tu cuenta fue creada.`
                    : null
                }
                onSuccess={this.handleLoginSuccess}
              />
            }
          />
          <Route
            path="/registro"
            element={<RegisterPage onComplete={this.handleRegisterComplete} />}
          />

          {/* Ruta sin path: solo aporta el layout (barra superior) a las de
              adentro, y así el NavBar no se remonta al cambiar de pantalla. */}
          <Route element={<AppLayout viewRole={viewRole} user={user} />}>
            <Route path="/" element={<CalendarPage viewRole={viewRole} />} />
            <Route
              path="/perfil"
              element={
                <ProfilePage
                  user={user}
                  viewRole={viewRole}
                  onUserChange={this.handleUserChange}
                  onLogout={this.handleLogout}
                />
              }
            />
            <Route path="/buscar" element={<SearchResultsPage />} />
            {/* Dos rutas para la misma pantalla: con materia (desde el botón
                de cada materia del perfil) y sin materia (desde el ícono de
                la barra). La v7 de react-router sacó los parámetros
                opcionales, así que no se puede escribir en una sola. */}
            <Route
              path="/disponibilidad"
              element={<AvailabilityPage viewRole={viewRole} user={user} />}
            />
            <Route
              path="/disponibilidad/:materiaId"
              element={<AvailabilityPage viewRole={viewRole} user={user} />}
            />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    )
  }
}

export default App

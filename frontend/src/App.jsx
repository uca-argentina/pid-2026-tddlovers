import { Component } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './routes/AppLayout.jsx'
import SessionLoading from './routes/SessionLoading.jsx'
import AdminPage from './pages/Admin/AdminPage.jsx'
import PacksPage from './pages/Packs/PacksPage.jsx'
import AvailabilityPage from './pages/Availability/AvailabilityPage.jsx'
import CalendarPage from './pages/Calendar/CalendarPage.jsx'
import FavoritesPage from './pages/Favorites/FavoritesPage.jsx'
import HomeworkPage from './pages/Homework/HomeworkPage.jsx'
import LoginPage from './pages/Login/LoginPage.jsx'
import NeuronasPage from './pages/Neuronas/NeuronasPage.jsx'
import ProfilePage from './pages/Profile/ProfilePage.jsx'
import RegisterPage from './pages/Register/RegisterPage.jsx'
import ReservationsPage from './pages/Reservations/ReservationsPage.jsx'
import { fetchCurrentUser, logoutAccount } from './api/client.js'
import { roleOf } from './utils/user.js'

/**
 * Punto de montaje de la app, con rutas de verdad (react-router-dom). La
 * pantalla de entrada es el calendario.
 *
 * La sesión vive en una cookie httpOnly que pone el backend. Al montar se
 * pregunta por /api/auth/me: si hay sesión, se recupera el usuario y
 * refrescar no desloguea; si no, `user` queda en null y el perfil muestra el
 * cartel de "iniciá sesión".
 *
 * Las pantallas de adentro no se montan hasta que /me contesta: el rol sale
 * del usuario, y montarlas antes con un rol supuesto hacía que un docente
 * que recargaba se perdiera lo que cada pantalla carga al montar (el aviso
 * de solicitudes) o viera un instante el tablero del alumno.
 *
 * Todas las redirecciones se hacen con <Navigate> y todos los links con
 * <Link>/<NavLink>: son componentes comunes, no hooks, así que esto sigue
 * siendo un class component como el resto de la app.
 *
 * Estado: `user` (el usuario público de /api/auth/me, login o PATCH
 * /api/users/me; null sin sesión), `justRegisteredName` (para el saludo del
 * login después de registrarse) y `sessionChecked`.
 * A cada pantalla le pasa por props `viewRole` (roleOf(user), utils/user.js)
 * y, a las que lo necesitan, `user` y los callbacks que lo actualizan.
 * Rutas: /ingresar, /registro, y dentro de AppLayout: / (calendario, o
 * /admin para el admin), /admin, /perfil, /reservas, /tareas, /neuronas,
 * /paquetes, /favoritos y /disponibilidad (docente: sus ventanas; alumno: el
 * tablero de reservas).
 * Lo monta: main.jsx.
 */
class App extends Component {
  state = {
    user: null,
    justRegisteredName: null,
    // Si /api/auth/me ya contestó (con usuario o sin él).
    sessionChecked: false,
  }

  /**
   * Recupera la sesión al abrir la app. Un 401 es lo normal cuando no hay
   * nadie logueado, así que no se muestra ningún error: simplemente se queda
   * sin usuario.
   */
  componentDidMount() {
    fetchCurrentUser()
      .then((user) => {
        this.setState({ user, sessionChecked: true })
      })
      .catch(() => {
        this.setState({ sessionChecked: true })
      })
  }

  // LoginPage la llama con el usuario que devolvió POST /api/auth/login.
  handleLoginSuccess = (user) => {
    this.setState({ user, justRegisteredName: null })
  }

  // RegisterPage la llama al terminar (con la respuesta de /register y el
  // nombre tipeado); solo se guarda el nombre para el saludo del login.
  handleRegisterComplete = (_result, nombre) => {
    this.setState({ justRegisteredName: nombre })
  }

  /**
   * App es el dueño de `user`, así que el perfil avisa para acá cuando
   * guarda. Sin esto, salir del perfil lo desmonta y al volver se vería el
   * dato viejo. Recibe el usuario que devolvió PATCH /api/users/me (o el
   * cambio de acceptsRewards).
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
    this.setState({ user: null, justRegisteredName: null })
  }

  render() {
    const { user, justRegisteredName, sessionChecked } = this.state
    // Desde qué rol se mira la app: el de la cuenta ('student' sin sesión).
    const viewRole = roleOf(user)

    return (
      <BrowserRouter>
        <Routes>
          {/* Sin guardia de "ya está logueado": la redirección después de
              entrar la hace LoginPage con su propio <Navigate>, así /ingresar
              se muestra enseguida, sin esperar a que /api/auth/me conteste. */}
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
              adentro, y así el NavBar no se remonta al cambiar de pantalla.
              Mientras no se sabe quién es, en vez del layout va la carga, que
              no tiene <Outlet />: ninguna pantalla se monta todavía. */}
          <Route
            element={
              sessionChecked ? <AppLayout viewRole={viewRole} user={user} /> : <SessionLoading />
            }
          >
            {/* El admin no tiene calendario ni reservas: su pantalla de
                entrada es la revisión de docentes. */}
            <Route
              path="/"
              element={
                viewRole === 'admin' ? (
                  <Navigate to="/admin" replace />
                ) : (
                  <CalendarPage viewRole={viewRole} />
                )
              }
            />
            <Route path="/admin" element={<AdminPage user={user} />} />
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
            <Route path="/reservas" element={<ReservationsPage viewRole={viewRole} />} />
            <Route path="/tareas" element={<HomeworkPage viewRole={viewRole} />} />
            <Route path="/neuronas" element={<NeuronasPage viewRole={viewRole} user={user} />} />
            <Route path="/paquetes" element={<PacksPage viewRole={viewRole} user={user} />} />
            <Route path="/favoritos" element={<FavoritesPage viewRole={viewRole} />} />
            <Route
              path="/disponibilidad"
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

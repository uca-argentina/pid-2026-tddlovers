import { Component } from 'react'
import { SpinnerIcon } from '../components/icons.jsx'
import './AppLayout.css'

/**
 * Lo que se ve mientras App pregunta quién está logueado (/api/auth/me). Va
 * en lugar de AppLayout y sin <Outlet />, así ninguna pantalla se monta con
 * un rol supuesto. Sin props: lo monta App.jsx mientras `sessionChecked` es false.
 */
class SessionLoading extends Component {
  render() {
    return (
      <div className="app-session-loading" role="status">
        <SpinnerIcon className="spin" />
        Cargando...
      </div>
    )
  }
}

export default SessionLoading

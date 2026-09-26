import { Component } from 'react'
import { Link, Navigate } from 'react-router-dom'
import withRouter from '../../routes/withRouter.jsx'
import TeacherAvailability from './TeacherAvailability.jsx'
import BookingBoard from '../Booking/BookingBoard.jsx'
import './AvailabilityPage.css'

/**
 * Disponibilidad. Según el rol es una de dos pantallas:
 *   - Docente: su semana como calendario, y un modal por día para cargar
 *     horarios (cuándo, modalidad y cupo; la materia y la duración las elige
 *     el alumno). Ver TeacherAvailability.
 *   - Alumno: el tablero para buscar horarios libres y reservar (ver
 *     pages/Booking). /disponibilidad/:materiaId solo tiene sentido ahí —
 *     deja esa materia filtrada.
 *
 * Por eso el primer guard de renderBody es el rol y no el usuario.
 */
class AvailabilityPage extends Component {
  /** Solo la usa el tablero del alumno. */
  getSubjectId() {
    return this.props.router.params.materiaId || null
  }

  /**
   * La pantalla del alumno: buscar horarios libres y (desde la ronda 2)
   * reservar. Va PRIMERO en renderBody y sin pedir usuario, igual que el
   * placeholder que reemplaza — las rutas de la app no tienen portero.
   *
   * Se le pasa `router` en vez de envolver BookingBoard en otro withRouter:
   * con un puente por ruta alcanza, y así sigue siendo obvio que los hooks
   * viven en un solo archivo.
   */
  renderStudentBooking() {
    return (
      <BookingBoard
        router={this.props.router}
        user={this.props.user}
        subjectId={this.getSubjectId()}
      />
    )
  }

  renderBody() {
    const { user, viewRole } = this.props

    // La vista de alumno va PRIMERO y no pide usuario: es informativa y las
    // rutas de la app no tienen portero (ver App.jsx). El login solo hace
    // falta para editar.
    if (viewRole !== 'teacher') return this.renderStudentBooking()

    if (!user) {
      return (
        <div className="availability-empty">
          <p>Iniciá sesión para cargar tu disponibilidad.</p>
          <Link className="auth-link" to="/ingresar">
            Ir al login
          </Link>
        </div>
      )
    }

    // Links viejos del perfil (una disponibilidad por materia): al docente
    // la materia no le dice nada acá, así que se limpia la URL.
    if (this.getSubjectId() !== null) return <Navigate to="/disponibilidad" replace />

    return <TeacherAvailability user={user} />
  }

  render() {
    // El tablero del alumno se clava al alto de la pantalla (el calendario
    // ocupa todo lo que hay y las tarjetas scrollean adentro); las otras
    // vistas de esta ruta son documentos que crecen para abajo y scrollean en
    // .app-main.
    const esTablero = this.props.viewRole !== 'teacher'

    return (
      <div className={`availability-page ${esTablero ? 'is-board' : ''}`}>{this.renderBody()}</div>
    )
  }
}

AvailabilityPage.defaultProps = {
  viewRole: 'student',
}

export default withRouter(AvailabilityPage)

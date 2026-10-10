import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { ClockIcon, SpinnerIcon } from '../../components/icons.jsx'
import { fetchFavoriteTeachers } from '../../api/client.js'
import './FavoritesPage.css'

/**
 * "Mis favoritos": los docentes que el alumno marcó con el corazón (desde el
 * tablero de Reservar o desde Mis reservas), con las materias que ofrecen y
 * un atajo a sus horarios.
 *
 * Solo vienen los docentes aprobados: si a uno lo dan de baja, el favorito
 * queda guardado pero no aparece acá hasta que lo vuelvan a aprobar.
 *
 * "Ver horarios" reusa el buscador: lleva al tablero con ?q=<nombre>, que lo
 * filtra por ese docente igual que si se lo hubiera buscado arriba.
 */
class FavoritesPage extends Component {
  state = {
    teachers: [],
    loading: true,
    error: null,
  }

  fetchToken = 0

  componentDidMount() {
    this.load()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.viewRole !== this.props.viewRole) this.load()
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  load() {
    const token = ++this.fetchToken
    if (this.props.viewRole !== 'student') {
      this.setState({ teachers: [], loading: false, error: null })
      return
    }
    this.setState({ loading: true, error: null })
    fetchFavoriteTeachers()
      .then((teachers) => {
        if (token !== this.fetchToken) return
        this.setState({ teachers: Array.isArray(teachers) ? teachers : [], loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus favoritos.',
        })
      })
  }

  /**
   * Acá el corazón solo puede sacar: el docente se va de la lista apenas el
   * backend lo confirma.
   */
  handleFavoriteChange = (teacherId, favorite) => {
    if (favorite) return
    this.setState((prev) => ({
      teachers: prev.teachers.filter((teacher) => String(teacher.id) !== String(teacherId)),
      error: null,
    }))
  }

  handleFavoriteError = (message) => {
    this.setState({ error: message })
  }

  renderTeacher(teacher) {
    const nombre = [teacher.nombre, teacher.apellido].filter(Boolean).join(' ')
    const materias = (teacher.subjects || []).map((subject) => subject.name).join(' · ')

    return (
      <li key={teacher.id} className="favorite-item">
        <div className="favorite-item-head">
          <span className="favorite-item-name">{nombre}</span>
          <FavoriteButton
            teacherId={teacher.id}
            teacherName={nombre}
            favorite
            onChange={this.handleFavoriteChange}
            onError={this.handleFavoriteError}
          />
        </div>
        <p className="favorite-item-subjects">
          {materias || 'Por ahora no tiene materias para reservar.'}
        </p>
        <div className="favorite-item-actions">
          <Link
            to={`/disponibilidad?q=${encodeURIComponent(nombre)}`}
            className="favorite-action"
            aria-label={`Ver los horarios de ${nombre}`}
          >
            <ClockIcon />
            Ver horarios
          </Link>
        </div>
      </li>
    )
  }

  renderBody() {
    const { teachers, loading } = this.state
    if (this.props.viewRole !== 'student') {
      return <p className="favorites-empty">Los docentes favoritos son para los alumnos.</p>
    }
    if (loading) {
      return (
        <p className="favorites-empty">
          <SpinnerIcon className="spin" />
          Cargando favoritos...
        </p>
      )
    }
    if (teachers.length === 0) {
      return (
        <p className="favorites-empty">
          Todavía no tenés docentes favoritos. Marcalos con el corazón desde Reservar o desde Mis
          reservas.
        </p>
      )
    }
    return <ul className="favorites-list">{teachers.map((teacher) => this.renderTeacher(teacher))}</ul>
  }

  render() {
    return (
      <div className="favorites-page">
        <h1 className="favorites-title">Mis favoritos</h1>
        <p className="favorites-subtitle">
          Los docentes que marcaste con el corazón. Entrá a sus horarios para reservar.
        </p>
        {this.state.error ? <Banner type="danger">{this.state.error}</Banner> : null}
        {this.renderBody()}
      </div>
    )
  }
}

FavoritesPage.defaultProps = {
  viewRole: 'student',
}

export default FavoritesPage

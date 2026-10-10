import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import ClassActions from '../../components/ClassActions.jsx'
import FavoriteButton from '../../components/FavoriteButton.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { fetchClasses, fetchFavoriteTeachers } from '../../api/client.js'
import { formatRangeLabel } from '../../utils/availability.js'
import { addDays, formatDayLong, fromISODate, toISODate } from '../../utils/calendar.js'
import { favoriteIdsOf, isFavorite, withFavorite } from '../../utils/favorites.js'
import { formatMoney } from '../../utils/rates.js'
import { modalityLabel } from '../../utils/windows.js'
import './ReservationsPage.css'

// Qué se muestra: lo reciente y lo que viene. Más atrás es historia que el
// calendario igual tiene; más adelante no suele haber nada.
const DAYS_BACK = 30
const DAYS_AHEAD = 90

// El orden de las secciones es el orden en que hay que hacer algo con ellas:
// arriba lo que espera respuesta o pago, abajo lo cerrado.
const SECTIONS = [
  { key: 'pendiente', title: 'Pendientes', statuses: ['pendiente'] },
  { key: 'aceptada', title: 'Aceptadas', statuses: ['aceptada'] },
  { key: 'confirmada', title: 'Confirmadas', statuses: ['confirmada'] },
  { key: 'dadas', title: 'Realizadas y no presentadas', statuses: ['realizada', 'no_presentada'] },
  { key: 'cancelada', title: 'Canceladas', statuses: ['cancelada'] },
]

// Lo que ya pasó se lee de lo más nuevo a lo más viejo; lo que viene, al revés.
const NEWEST_FIRST = new Set(['dadas', 'cancelada'])

/**
 * "Mis reservas": todas las reservas del usuario, en cualquier estado, en una
 * lista agrupada. Es la misma información que el calendario pero pensada para
 * gestionar: el docente ve de un vistazo qué tiene que aceptar, el alumno qué
 * tiene que pagar, y las canceladas (que el calendario no muestra) están acá
 * con el motivo.
 *
 * A diferencia del calendario, una grupal no se junta: cada reserva es de un
 * alumno y se acepta o cancela por separado.
 *
 * El alumno puede marcar desde acá a sus docentes como favoritos: es donde
 * están los docentes con los que ya tomó clase.
 */
class ReservationsPage extends Component {
  state = {
    classes: [],
    loading: true,
    error: null,
    // Ids (string) de los docentes favoritos; null = no se muestran corazones.
    favoriteIds: null,
    favoriteError: null,
  }

  fetchToken = 0

  favoritesToken = 0

  componentDidMount() {
    this.load()
    this.loadFavorites()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.viewRole !== this.props.viewRole) this.loadFavorites()
  }

  componentWillUnmount() {
    this.fetchToken += 1
    this.favoritesToken += 1
  }

  /**
   * Solo el alumno tiene favoritos. Si el pedido falla no se muestran los
   * corazones: uno vacío para un docente que ya es favorito mentiría.
   */
  loadFavorites() {
    const token = ++this.favoritesToken
    if (this.props.viewRole !== 'student') {
      this.setState({ favoriteIds: null })
      return
    }
    fetchFavoriteTeachers()
      .then((teachers) => {
        if (token !== this.favoritesToken) return
        this.setState({ favoriteIds: favoriteIdsOf(teachers) })
      })
      .catch(() => {
        if (token === this.favoritesToken) this.setState({ favoriteIds: null })
      })
  }

  handleFavoriteChange = (teacherId, favorite) => {
    this.setState((prev) => ({
      favoriteIds: withFavorite(prev.favoriteIds, teacherId, favorite),
      favoriteError: null,
    }))
  }

  handleFavoriteError = (message) => {
    this.setState({ favoriteError: message })
  }

  load = () => {
    const token = ++this.fetchToken
    const hoy = new Date()
    this.setState({ loading: true, error: null })
    fetchClasses({
      from: toISODate(addDays(hoy, -DAYS_BACK)),
      to: toISODate(addDays(hoy, DAYS_AHEAD)),
    })
      .then((classes) => {
        if (token !== this.fetchToken) return
        this.setState({ classes: Array.isArray(classes) ? classes : [], loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus reservas.',
        })
      })
  }

  handleChange = (updated) => {
    if (!updated?.id) return
    this.setState((prev) => ({
      classes: prev.classes.map((item) => (String(item.id) === String(updated.id) ? updated : item)),
    }))
  }

  getSections() {
    return SECTIONS.map((section) => {
      const items = this.state.classes
        .filter((item) => section.statuses.includes(item.status))
        .sort((a, b) => {
          const ka = `${a.date} ${a.startTime}`
          const kb = `${b.date} ${b.startTime}`
          return NEWEST_FIRST.has(section.key) ? kb.localeCompare(ka) : ka.localeCompare(kb)
        })
      return { ...section, items }
    }).filter((section) => section.items.length > 0)
  }

  renderItem(item) {
    const { viewRole } = this.props
    const otro =
      viewRole === 'teacher'
        ? `Alumno: ${item.studentName || 'Sin nombre'}`
        : `Docente: ${item.teacherName}`

    return (
      <li key={item.id} className="reservation-item">
        <div className="reservation-head">
          <span className="reservation-date">{formatDayLong(fromISODate(item.date))}</span>
          <span className="reservation-time">{formatRangeLabel(item.startTime, item.endTime)}</span>
        </div>
        <p className="reservation-subject">{item.subjectName}</p>
        <div className="reservation-meta-row">
          <p className="reservation-meta">
            {otro}
            {` · ${modalityLabel(item.modality)}`}
            {` · ${formatMoney(item.priceCents)}`}
            {item.packTokens > 0
              ? ` · ${item.packTokens === 1 ? '1 clase' : `${item.packTokens} clases`} del paquete`
              : ''}
          </p>
          {viewRole === 'student' && this.state.favoriteIds ? (
            <FavoriteButton
              teacherId={item.teacherId}
              teacherName={item.teacherName}
              favorite={isFavorite(this.state.favoriteIds, item.teacherId)}
              onChange={this.handleFavoriteChange}
              onError={this.handleFavoriteError}
            />
          ) : null}
        </div>
        <ClassActions cls={item} viewRole={viewRole} onChange={this.handleChange} />
      </li>
    )
  }

  renderBody() {
    const { loading, error } = this.state
    if (loading) {
      return (
        <p className="reservations-empty">
          <SpinnerIcon className="spin" />
          Cargando reservas...
        </p>
      )
    }
    if (error) return <Banner type="danger">{error}</Banner>

    const sections = this.getSections()
    if (sections.length === 0) {
      return (
        <p className="reservations-empty">
          {this.props.viewRole === 'teacher'
            ? 'Todavía no te reservaron ninguna clase.'
            : 'Todavía no reservaste ninguna clase.'}
        </p>
      )
    }

    return sections.map((section) => (
      <section key={section.key} className="reservations-section" aria-labelledby={`reservas-${section.key}`}>
        <h2 className="reservations-section-title" id={`reservas-${section.key}`}>
          {section.title} <span className="reservations-count">{section.items.length}</span>
        </h2>
        <ul className="reservations-list">{section.items.map((item) => this.renderItem(item))}</ul>
      </section>
    ))
  }

  render() {
    return (
      <div className="reservations-page">
        <h1 className="reservations-title">Mis reservas</h1>
        <p className="reservations-subtitle">
          {this.props.viewRole === 'teacher'
            ? 'Aceptá o rechazá las solicitudes y tomá lista de las clases que diste.'
            : 'Seguí el estado de tus clases: pagalas cuando el docente las acepte.'}
        </p>
        {this.state.favoriteError ? (
          <Banner type="danger">{this.state.favoriteError}</Banner>
        ) : null}
        {this.renderBody()}
      </div>
    )
  }
}

ReservationsPage.defaultProps = {
  viewRole: 'student',
}

export default ReservationsPage

import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import ClassCard from '../../components/ClassCard.jsx'
import ClassDetailDialog from '../../components/ClassDetailDialog.jsx'
import { ChevronRightIcon, SpinnerIcon } from '../../components/icons.jsx'
import { fetchClasses, fetchFavoriteTeachers } from '../../api/client.js'
import { addDays, toISODate } from '../../utils/calendar.js'
import { hasStarted, nowParts } from '../../utils/classStates.js'
import { favoriteIdsOf, withFavorite } from '../../utils/favorites.js'
import {
  CATEGORIES,
  groupTurns,
  lastClass,
  nextClass,
  turnKey,
  turnRows,
  turnSiblings,
  turnsIn,
} from '../../utils/reservations.js'
import CategoryDialog from './CategoryDialog.jsx'
import './ReservationsPage.css'

// Qué se carga: medio año para atrás, para que Finalizadas y Canceladas
// tengan historia, y lo que viene (más adelante no suele haber nada).
const DAYS_BACK = 180
const DAYS_AHEAD = 90

/**
 * "Mis reservas": todas las reservas del usuario, en cualquier estado. Arriba
 * la próxima clase y la última (la última es por donde el docente entra a
 * tomar lista o a cargar el material); abajo, una tarjeta por estado que abre
 * la lista de ese estado en una hoja alta. Tocar una reserva abre su detalle
 * (ClassDetailDialog), encima de la lista.
 *
 * Una grupal es UNA tarjeta aunque el docente tenga una reserva por alumno:
 * la tarjeta no lleva nombres y sus botones actúan sobre la clase entera. A
 * los alumnos se los ve, y se decide sobre cada uno, en el detalle.
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
    // La categoría abierta (su key) y la reserva en detalle (su id).
    openCategory: null,
    detailId: null,
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

  now() {
    return this.props.now || nowParts()
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

  /** El material es del turno: el clip aparece en todas las reservas de ese turno. */
  handleMaterialChange = (cls, hasMaterial) => {
    const key = turnKey(cls)
    this.setState((prev) => ({
      classes: prev.classes.map((item) => (turnKey(item) === key ? { ...item, hasMaterial } : item)),
    }))
  }

  handleOpenCategory = (key) => () => this.setState({ openCategory: key })

  handleCloseCategory = () => this.setState({ openCategory: null })

  handleOpenClass = (cls) => this.setState({ detailId: cls.id })

  handleCloseClass = () => this.setState({ detailId: null })

  /**
   * La tarjeta de una clase, con todas las reservas de su turno. La próxima
   * y la última van sin botones: son para saber cuál es y entrar al detalle.
   */
  renderCard(cls, { summary = false, badge = null } = {}) {
    return (
      <ClassCard
        key={cls.id}
        cls={cls}
        rows={turnRows(cls, this.state.classes)}
        viewRole={this.props.viewRole}
        favoriteIds={this.state.favoriteIds}
        showActions={!summary}
        badge={badge}
        onOpen={this.handleOpenClass}
        onChange={this.handleChange}
        onFavoriteChange={this.handleFavoriteChange}
        onFavoriteError={this.handleFavoriteError}
      />
    )
  }

  /** Lo que el docente tiene pendiente con la última clase, si algo. */
  lastBadge(cls) {
    if (this.props.viewRole !== 'teacher') return null
    const sinLista = turnSiblings(cls, this.state.classes).some((row) =>
      ['aceptada', 'confirmada'].includes(row.status),
    )
    return sinLista ? { label: 'Falta tomar lista', tone: 'warning' } : null
  }

  renderHighlights() {
    const now = this.now()
    const proxima = nextClass(this.state.classes, now)
    const ultima = lastClass(this.state.classes, now)
    const enCurso = proxima && hasStarted(proxima, now)

    return (
      <div className="reservations-highlights">
        <section className="reservations-highlight" aria-labelledby="reservas-proxima">
          <h2 className="reservations-section-title" id="reservas-proxima">
            Próxima clase
          </h2>
          {proxima ? (
            <ul className="reservations-list">
              {this.renderCard(proxima, {
                summary: true,
                badge: enCurso ? { label: 'En curso', tone: 'success' } : null,
              })}
            </ul>
          ) : (
            <p className="reservations-highlight-empty">No tenés clases próximas.</p>
          )}
        </section>
        <section className="reservations-highlight" aria-labelledby="reservas-ultima">
          <h2 className="reservations-section-title" id="reservas-ultima">
            Última clase
          </h2>
          {ultima ? (
            <ul className="reservations-list">
              {this.renderCard(ultima, { summary: true, badge: this.lastBadge(ultima) })}
            </ul>
          ) : (
            <p className="reservations-highlight-empty">Todavía no tuviste ninguna clase.</p>
          )}
        </section>
      </div>
    )
  }

  renderCategories() {
    const turns = groupTurns(this.state.classes)
    return (
      <ul className="reservations-categories" aria-label="Reservas por estado">
        {CATEGORIES.map((category) => {
          const count = turnsIn(category, turns).length
          const cantidad = `${count} ${count === 1 ? 'clase' : 'clases'}`
          return (
            <li key={category.key}>
              <button
                type="button"
                className={`reservations-category is-${category.key}`}
                onClick={this.handleOpenCategory(category.key)}
                aria-label={category.showCount ? `${category.title}: ${cantidad}` : category.title}
              >
                <span className="reservations-category-title">{category.title}</span>
                {category.showCount ? (
                  <span className="reservations-category-count" aria-hidden="true">
                    {count}
                  </span>
                ) : null}
                <ChevronRightIcon className="reservations-category-chevron" />
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  renderCategoryDialog() {
    const category = CATEGORIES.find((c) => c.key === this.state.openCategory)
    if (!category) return null
    return (
      <CategoryDialog
        category={category}
        turns={turnsIn(category, groupTurns(this.state.classes))}
        viewRole={this.props.viewRole}
        renderCard={this.renderListCard}
        onClose={this.handleCloseCategory}
      />
    )
  }

  renderListCard = (cls) => this.renderCard(cls)

  renderDetailDialog() {
    const { detailId, classes } = this.state
    if (!detailId) return null
    const abierta = classes.find((item) => String(item.id) === String(detailId))
    if (!abierta) return null
    // Siempre la que representa al turno: si la reserva abierta se canceló
    // (un alumno de la grupal), la clase sigue con los demás.
    const cls = turnRows(abierta, classes)[0]

    return (
      <ClassDetailDialog
        cls={cls}
        classes={classes}
        viewRole={this.props.viewRole}
        now={this.props.now}
        onClose={this.handleCloseClass}
        onChange={this.handleChange}
        onMaterialChange={this.handleMaterialChange}
      />
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

    return (
      <>
        {this.renderHighlights()}
        {this.renderCategories()}
        {this.renderCategoryDialog()}
        {this.renderDetailDialog()}
      </>
    )
  }

  render() {
    return (
      <div className="reservations-page">
        <h1 className="reservations-title">Mis reservas</h1>
        <p className="reservations-subtitle">
          {this.props.viewRole === 'teacher'
            ? 'Aceptá las solicitudes, tomá lista y dejá el material de las clases que diste.'
            : 'Seguí el estado de tus clases y mirá el material que dejó el docente.'}
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
  // Inyectable para los tests; en la app es la hora real.
  now: null,
}

export default ReservationsPage

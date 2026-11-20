import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import ClassCard from '../../components/ClassCard.jsx'
import ClassDetailDialog from '../../components/ClassDetailDialog.jsx'
import { ChevronRightIcon, SpinnerIcon } from '../../components/icons.jsx'
import { fetchBookings } from '../../api/client.js'
import withFavorites from '../../routes/withFavorites.jsx'
import { addDays, toISODate } from '../../utils/calendar.js'
import { hasStarted, nowParts } from '../../utils/bookingStates.js'
import {
  CATEGORIES,
  groupClasses,
  lastClass,
  nextClass,
  classRows,
  classSiblings,
  classesIn,
  withClassMaterial,
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
 * están los docentes con los que ya tomó clase. La lista la baja
 * withFavorites.
 *
 * Ruta /reservas (docente y alumno).
 *
 * Props:
 *   - viewRole: de App.
 *   - now: "ahora" inyectable para tests (en la app es null → nowParts()).
 *   - favoriteIds, onFavoriteChange, onFavoriteError: de withFavorites.
 *
 * Datos: fetchBookings → GET /api/bookings?from&to (de hoy − 180 a hoy + 90
 * días), solo al montar. Los cambios posteriores llegan como la clase
 * actualizada que devuelve cada acción (handleChange), sin volver a pedir.
 *
 * Estado: bookings (filas de GET /api/bookings, una por reserva), loading,
 * error, openCategory (key de CATEGORIES con la hoja abierta) y detailId (id
 * de la reserva abierta en ClassDetailDialog).
 */
class ReservationsPage extends Component {
  state = {
    bookings: [],
    loading: true,
    error: null,
    // La categoría abierta (su key) y la reserva en detalle (su id).
    openCategory: null,
    detailId: null,
  }

  fetchToken = 0

  componentDidMount() {
    this.load()
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  now() {
    return this.props.now || nowParts()
  }

  /** Trae las reservas del usuario (GET /api/bookings, ver DAYS_BACK/DAYS_AHEAD) → `bookings`. */
  load = () => {
    const token = ++this.fetchToken
    const hoy = new Date()
    this.setState({ loading: true, error: null })
    fetchBookings({
      from: toISODate(addDays(hoy, -DAYS_BACK)),
      to: toISODate(addDays(hoy, DAYS_AHEAD)),
    })
      .then((bookings) => {
        if (token !== this.fetchToken) return
        this.setState({ bookings, loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus reservas.',
        })
      })
  }

  /**
   * Una acción devolvió una reserva actualizada (de POST /api/bookings/:id/…):
   * se reemplaza esa fila por id, sin volver a pedir la lista.
   */
  handleChange = (updated) => {
    if (!updated?.id) return
    this.setState((prev) => ({
      bookings: prev.bookings.map((item) => (String(item.id) === String(updated.id) ? updated : item)),
    }))
  }

  /** El material es de la clase: el clip aparece en todas sus reservas en pie. */
  handleMaterialChange = (cls, hasMaterial) => {
    this.setState((prev) => ({ bookings: withClassMaterial(prev.bookings, cls, hasMaterial) }))
  }

  handleOpenCategory = (key) => () => this.setState({ openCategory: key })

  handleCloseCategory = () => this.setState({ openCategory: null })

  handleOpenClass = (cls) => this.setState({ detailId: cls.id })

  handleCloseClass = () => this.setState({ detailId: null })

  /**
   * La tarjeta de una clase, con todas las reservas de su clase. La próxima
   * y la última van sin botones: son para saber cuál es y entrar al detalle.
   */
  renderCard(cls, { summary = false, badge = null } = {}) {
    return (
      <ClassCard
        key={cls.id}
        cls={cls}
        rows={classRows(cls, this.state.bookings)}
        viewRole={this.props.viewRole}
        favoriteIds={this.props.favoriteIds}
        showActions={!summary}
        badge={badge}
        onOpen={this.handleOpenClass}
        onChange={this.handleChange}
        onFavoriteChange={this.props.onFavoriteChange}
        onFavoriteError={this.props.onFavoriteError}
      />
    )
  }

  /**
   * FILTRO: el aviso "Falta tomar lista" de la última clase, solo para el
   * docente (regla de pantalla).
   */
  lastBadge(cls) {
    if (this.props.viewRole !== 'teacher') return null
    const sinLista = classSiblings(cls, this.state.bookings).some((row) =>
      ['aceptada', 'confirmada'].includes(row.status),
    )
    return sinLista ? { label: 'Falta tomar lista', tone: 'warning' } : null
  }

  renderHighlights() {
    const now = this.now()
    const proxima = nextClass(this.state.bookings, now)
    const ultima = lastClass(this.state.bookings, now)
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
    // FILTRO: cada categoría cuenta solo sus clases (classesIn en
    // utils/reservations.js; regla de pantalla).
    const entries = groupClasses(this.state.bookings)
    return (
      <ul className="reservations-categories" aria-label="Reservas por estado">
        {CATEGORIES.map((category) => {
          const count = classesIn(category, entries).length
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
        entries={classesIn(category, groupClasses(this.state.bookings))}
        viewRole={this.props.viewRole}
        renderCard={this.renderListCard}
        onClose={this.handleCloseCategory}
      />
    )
  }

  renderListCard = (cls) => this.renderCard(cls)

  renderDetailDialog() {
    const { detailId, bookings } = this.state
    if (!detailId) return null
    const abierta = bookings.find((item) => String(item.id) === String(detailId))
    if (!abierta) return null
    // Siempre la que representa a la clase: si la reserva abierta se canceló
    // (un alumno de la grupal), la clase sigue con los demás.
    const cls = classRows(abierta, bookings)[0]

    return (
      <ClassDetailDialog
        cls={cls}
        bookings={bookings}
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
        {this.props.favoriteError ? (
          <Banner type="danger">{this.props.favoriteError}</Banner>
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

export default withFavorites(ReservationsPage)

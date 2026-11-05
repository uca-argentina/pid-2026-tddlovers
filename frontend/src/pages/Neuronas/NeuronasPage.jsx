import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import { ChevronLeftIcon, SpinnerIcon } from '../../components/icons.jsx'
import withViewport from '../../routes/withViewport.jsx'
import { buyFeatured, fetchNeuronas } from '../../api/client.js'
import { formatPackDate } from '../../utils/packs.js'
import {
  REWARDS,
  formatNeuronas,
  levelProgress,
  movementLabel,
} from '../../utils/neuronas.js'
import './NeuronasPage.css'

const DATE_FORMAT = new Intl.DateTimeFormat('es-AR', {
  day: 'numeric',
  month: 'short',
  timeZone: 'America/Argentina/Buenos_Aires',
})

const STUDENT_EARNINGS = [
  ['Clase con presente', '10 por hora'],
  ['Tarea entregada antes del vencimiento', '10'],
]

const TEACHER_EARNINGS = [
  ['Clase dada', '10 por hora, y la mitad por cada presente extra'],
  ['Devolución en menos de 24 h', '10'],
  ['Devolución entre 24 y 72 h', '6'],
  ['Devolución entre 72 y 168 h', '3'],
  ['Clase canjeada que diste', 'La mitad de lo que gastó el alumno'],
]

/**
 * Las neuronas del usuario: saldo, nivel, en qué se usan y el historial.
 *
 * Qué secciones se muestran sale de la respuesta y no de viewRole: el backend
 * contesta según el rol de la sesión, y viewRole arranca en 'student' hasta que
 * App recupera al usuario.
 *
 * En el teléfono no es una pestaña: se llega desde el Perfil, así que arriba va
 * el "‹ Perfil" de iOS para volver.
 */
class NeuronasPage extends Component {
  state = {
    data: null,
    loading: true,
    buying: false,
    error: null,
    notice: null,
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
    return fetchNeuronas()
      .then((data) => {
        if (token === this.fetchToken) this.setState({ data, loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus neuronas.',
        })
      })
  }

  handleBuyFeatured = () => {
    this.setState({ buying: true, error: null, notice: null })
    buyFeatured()
      .then(({ endDate }) => {
        this.setState({
          buying: false,
          notice: `¡Listo! Vas a aparecer como Destacado hasta el ${formatPackDate(endDate)}.`,
        })
        return this.load()
      })
      .catch((error) => {
        this.setState({
          buying: false,
          error: error.message || 'No se pudo comprar el Destacado. Probá de nuevo.',
        })
      })
  }

  renderSummary() {
    const { balance, earned, level } = this.state.data
    const progress = levelProgress(level, earned)
    return (
      <section className="neuronas-card neuronas-summary">
        <p className="neuronas-balance-label">Tu saldo</p>
        <p className="neuronas-balance">{formatNeuronas(balance)}</p>
        <div className="neuronas-level">
          <div className="neuronas-level-head">
            <strong>{level.name}</strong>
            <span>
              {level.nextName
                ? `Faltan ${formatNeuronas(level.nextMin - earned)} para ${level.nextName}`
                : 'Llegaste al nivel más alto'}
            </span>
          </div>
          <div
            className="neuronas-level-bar"
            role="progressbar"
            aria-label={`Progreso del nivel ${level.name}`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progress}
          >
            <span style={{ width: `${progress}%` }} />
          </div>
          <p className="neuronas-note">Gastar neuronas no te baja de nivel.</p>
        </div>
      </section>
    )
  }

  renderBadges() {
    const { badges } = this.state.data
    if (!badges) return null
    return (
      <section className="neuronas-section">
        <h2 className="neuronas-section-title">Insignias</h2>
        <ul className="neuronas-badges">
          {badges.map((badge) => (
            <li key={badge.key} className={`neuronas-badge ${badge.earned ? 'is-earned' : ''}`}>
              {badge.earned ? '✓ ' : ''}
              {badge.label}
            </li>
          ))}
        </ul>
      </section>
    )
  }

  renderRewards() {
    const { data } = this.state
    if (data.featured) return null
    return (
      <section className="neuronas-section">
        <h2 className="neuronas-section-title">En qué las usás</h2>
        <ul className="neuronas-list">
          {Object.entries(REWARDS).map(([type, reward]) => (
            <li key={type} className="neuronas-row">
              <span>{reward.label}</span>
              <strong>{formatNeuronas(reward.cost)}</strong>
            </li>
          ))}
        </ul>
        <p className="neuronas-note">
          Se usan al reservar, con los docentes que aceptan neuronas. El descuento se aplica sobre
          la primera hora de la clase. Si la clase se cancela, las neuronas vuelven a tu saldo.
        </p>
      </section>
    )
  }

  /** Por qué no se puede comprar ahora, o null si se puede. */
  featuredProblem() {
    const { balance, featured } = this.state.data
    if (this.props.user?.approvalStatus !== 'approved') {
      return 'Vas a poder destacarte cuando un administrador te apruebe.'
    }
    if (featured.activeUntil) return null
    if (featured.slotsLeft === 0) return 'Ya no quedan lugares. Probá de nuevo en unos días.'
    if (balance < featured.cost) return `Te faltan ${formatNeuronas(featured.cost - balance)}.`
    return null
  }

  renderFeatured() {
    const { featured } = this.state.data
    if (!featured) return null
    const problem = this.featuredProblem()
    const { buying } = this.state

    return (
      <section className="neuronas-section">
        <h2 className="neuronas-section-title">Destacado</h2>
        <div className="neuronas-card">
          <p className="neuronas-featured-text">
            Durante {featured.days} días, tus horarios aparecen primero cada día en la búsqueda de
            los alumnos, con la etiqueta «Destacado». Cuesta {formatNeuronas(featured.cost)}.
          </p>
          {featured.activeUntil ? (
            <p className="neuronas-featured-active">
              Estás destacado hasta el {formatPackDate(featured.activeUntil)}.
            </p>
          ) : (
            <button
              type="button"
              className="class-action is-primary"
              onClick={this.handleBuyFeatured}
              disabled={buying || Boolean(problem)}
            >
              {buying ? <SpinnerIcon className="spin" /> : null}
              Destacarme
            </button>
          )}
          {problem ? <p className="neuronas-note">{problem}</p> : null}
        </div>
      </section>
    )
  }

  renderEarnings() {
    const filas = this.state.data.featured ? TEACHER_EARNINGS : STUDENT_EARNINGS
    return (
      <section className="neuronas-section">
        <h2 className="neuronas-section-title">Cómo se ganan</h2>
        <ul className="neuronas-list">
          {filas.map(([accion, cuanto]) => (
            <li key={accion} className="neuronas-row">
              <span>{accion}</span>
              <strong>{cuanto}</strong>
            </li>
          ))}
        </ul>
        <p className="neuronas-note">
          Las clases gratis no suman. Las clases solo cuentan si están pagas o cubiertas por un
          paquete, las tareas necesitan al menos 24 h de plazo, y hay topes por día y por semana.
        </p>
      </section>
    )
  }

  renderMovements() {
    const { movements } = this.state.data
    return (
      <section className="neuronas-section">
        <h2 className="neuronas-section-title">Historial</h2>
        {movements.length === 0 ? (
          <p className="neuronas-note">Todavía no tenés movimientos.</p>
        ) : (
          <ul className="neuronas-list">
            {movements.map((movement) => (
              <li key={`${movement.reason}-${movement.id}`} className="neuronas-row">
                <span>
                  {movementLabel(movement.reason)}
                  <span className="neuronas-row-detail">
                    {[movement.detail, DATE_FORMAT.format(new Date(movement.createdAt))]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                <strong className={movement.amount < 0 ? 'is-spent' : 'is-earned'}>
                  {movement.amount > 0 ? '+' : '−'}
                  {Math.abs(movement.amount)}
                </strong>
              </li>
            ))}
          </ul>
        )}
      </section>
    )
  }

  renderBody() {
    const { data, loading } = this.state
    if (loading) {
      return (
        <p className="neuronas-loading">
          <SpinnerIcon className="spin" />
          Cargando neuronas...
        </p>
      )
    }
    if (!data) return null
    return (
      <>
        {this.renderSummary()}
        {this.renderBadges()}
        {this.renderFeatured()}
        {this.renderRewards()}
        {this.renderEarnings()}
        {this.renderMovements()}
      </>
    )
  }

  render() {
    const { error, notice } = this.state
    return (
      <div className="neuronas-page">
        {this.props.mobile ? (
          <Link to="/perfil" className="neuronas-back">
            <ChevronLeftIcon />
            Perfil
          </Link>
        ) : null}
        <h1 className="neuronas-title">Mis neuronas</h1>
        <p className="neuronas-subtitle">Lo que sumás por aprender y enseñar, y en qué lo usás.</p>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {notice ? <Banner type="success">{notice}</Banner> : null}
        {this.renderBody()}
      </div>
    )
  }
}

NeuronasPage.defaultProps = {
  viewRole: 'student',
  user: null,
  mobile: false,
}

export default withViewport(NeuronasPage)

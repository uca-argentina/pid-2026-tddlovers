import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import FormField from '../../components/FormField.jsx'
import Modal from '../../components/Modal.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import {
  buyPack,
  createPackOffer,
  deletePackOffer,
  fetchMyPackOffers,
  fetchMyPacks,
  fetchPackOffers,
} from '../../api/client.js'
import { formatMoney, MAX_HOURLY_RATE_CENTS, parseMoney } from '../../utils/rates.js'
import { classesLabel, formatPackDate, validityLabel } from '../../utils/packs.js'
import './PacksPage.css'

// Los mismos límites que valida el backend (lib/classPacks.js).
const MIN_CLASSES = 2
const MAX_CLASSES = 100
const MAX_VALIDITY_DAYS = 365

const EMPTY_FORM = { classCount: '', price: '', validityDays: '30' }

function parseIntField(text) {
  return /^\d+$/.test(String(text).trim()) ? Number(text) : NaN
}

/**
 * Paquetes de clases. Según el rol es una de dos pantallas:
 *   - Docente: arma los paquetes que ofrece (cuántas clases, precio total y
 *     cuántos días dura desde la compra) y puede dejar de ofrecerlos.
 *   - Alumno: ve los paquetes que compró (cuántas clases le quedan y cuándo
 *     vence) y los que puede comprar.
 *
 * Un paquete sirve para cualquier clase de ese docente: al reservar, el
 * alumno sigue eligiendo materia, modalidad y duración, y marca que la usa
 * con el paquete. Cada asistencia descuenta una clase. Nada se cobra de
 * verdad: comprar solo lo registra, como pagar una clase.
 */
class PacksPage extends Component {
  state = {
    loading: true,
    error: null,
    // Docente
    offers: [],
    form: EMPTY_FORM,
    touched: {},
    saving: false,
    saveError: null,
    removing: null,
    // Alumno
    myPacks: [],
    catalog: [],
    buying: null,
    buyBusy: false,
    buyError: null,
    bought: null,
  }

  fetchToken = 0

  componentDidMount() {
    this.load()
  }

  componentDidUpdate(prevProps) {
    if (prevProps.viewRole !== this.props.viewRole || prevProps.user !== this.props.user) {
      this.load()
    }
  }

  componentWillUnmount() {
    this.fetchToken += 1
  }

  esDocente() {
    return this.props.viewRole === 'teacher'
  }

  load = () => {
    if (!this.props.user) {
      this.setState({ loading: false })
      return
    }
    const token = ++this.fetchToken
    this.setState({ loading: true, error: null })

    const pedido = this.esDocente()
      ? fetchMyPackOffers().then((offers) => ({ offers: Array.isArray(offers) ? offers : [] }))
      : Promise.all([fetchMyPacks(), fetchPackOffers()]).then(([myPacks, catalog]) => ({
          myPacks: Array.isArray(myPacks) ? myPacks : [],
          catalog: Array.isArray(catalog) ? catalog : [],
        }))

    pedido
      .then((data) => {
        if (token !== this.fetchToken) return
        this.setState({ ...data, loading: false })
      })
      .catch((error) => {
        if (token !== this.fetchToken) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar los paquetes.',
        })
      })
  }

  // --- Docente --------------------------------------------------------------

  getFormErrors() {
    const { classCount, price, validityDays } = this.state.form
    const errors = {}
    const cantidad = parseIntField(classCount)
    if (Number.isNaN(cantidad) || cantidad < MIN_CLASSES || cantidad > MAX_CLASSES) {
      errors.classCount = `Entre ${MIN_CLASSES} y ${MAX_CLASSES} clases.`
    }
    const centavos = parseMoney(price.trim())
    if (!price.trim() || Number.isNaN(centavos) || centavos > MAX_HOURLY_RATE_CENTS) {
      errors.price = 'Un monto en pesos, por ejemplo 18.000 o 18.000,50. 0 es sin cargo.'
    }
    const dias = parseIntField(validityDays)
    if (Number.isNaN(dias) || dias < 1 || dias > MAX_VALIDITY_DAYS) {
      errors.validityDays = `Entre 1 y ${MAX_VALIDITY_DAYS} días.`
    }
    return errors
  }

  handleFormChange = (field) => (event) => {
    const value = event.target.value
    this.setState((prev) => ({ form: { ...prev.form, [field]: value }, saveError: null }))
  }

  handleFormBlur = (field) => () => {
    this.setState((prev) => ({ touched: { ...prev.touched, [field]: true } }))
  }

  handleCreate = (event) => {
    event.preventDefault()
    if (this.state.saving) return
    const errors = this.getFormErrors()
    if (Object.keys(errors).length > 0) {
      this.setState({ touched: { classCount: true, price: true, validityDays: true } })
      return
    }

    const { classCount, price, validityDays } = this.state.form
    this.setState({ saving: true, saveError: null })
    createPackOffer({
      classCount: Number(classCount),
      priceCents: parseMoney(price.trim()),
      validityDays: Number(validityDays),
    })
      .then((offer) => {
        this.setState((prev) => ({
          saving: false,
          offers: [...prev.offers, offer],
          form: EMPTY_FORM,
          touched: {},
        }))
      })
      .catch((error) => {
        this.setState({
          saving: false,
          saveError: error.message || 'No se pudo guardar el paquete.',
        })
      })
  }

  handleRemove = (offer) => () => {
    if (this.state.removing) return
    this.setState({ removing: offer.id, error: null })
    deletePackOffer(offer.id)
      .then(() => {
        this.setState((prev) => ({
          removing: null,
          offers: prev.offers.filter((item) => String(item.id) !== String(offer.id)),
        }))
      })
      .catch((error) => {
        this.setState({
          removing: null,
          error: error.message || 'No se pudo quitar el paquete.',
        })
      })
  }

  renderTeacher() {
    const { offers, form, touched, saving, saveError, removing } = this.state
    const errors = this.getFormErrors()

    return (
      <>
        <section className="packs-section" aria-labelledby="packs-mine">
          <h2 className="packs-section-title" id="packs-mine">
            Paquetes que ofrecés
          </h2>
          {offers.length === 0 ? (
            <p className="packs-empty">Todavía no ofrecés ningún paquete.</p>
          ) : (
            <ul className="packs-list">
              {offers.map((offer) => (
                <li key={offer.id} className="pack-card">
                  <div className="pack-card-head">
                    <span className="pack-card-title">{classesLabel(offer.classCount)}</span>
                    <span className="pack-card-price">{formatMoney(offer.priceCents)}</span>
                  </div>
                  <p className="pack-card-meta">{validityLabel(offer.validityDays)} desde la compra</p>
                  <div className="pack-card-actions">
                    <button
                      type="button"
                      className="pack-action is-danger"
                      onClick={this.handleRemove(offer)}
                      disabled={Boolean(removing)}
                      aria-label={`Dejar de ofrecer el paquete de ${classesLabel(offer.classCount)}`}
                    >
                      {removing === offer.id ? <SpinnerIcon className="spin" /> : null}
                      Dejar de ofrecer
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="packs-section" aria-labelledby="packs-new">
          <h2 className="packs-section-title" id="packs-new">
            Nuevo paquete
          </h2>
          <form className="pack-form" onSubmit={this.handleCreate} noValidate>
            <p className="packs-hint">
              Sirve para cualquier clase tuya: el alumno elige materia, modalidad y duración al
              reservar. Cada asistencia que marcás descuenta una clase del paquete.
            </p>
            <div className="pack-form-fields">
              <FormField
                label="Cantidad de clases"
                inputMode="numeric"
                value={form.classCount}
                onChange={this.handleFormChange('classCount')}
                onBlur={this.handleFormBlur('classCount')}
                touched={touched.classCount}
                error={errors.classCount}
              />
              <FormField
                label="Precio total ($)"
                inputMode="decimal"
                value={form.price}
                onChange={this.handleFormChange('price')}
                onBlur={this.handleFormBlur('price')}
                touched={touched.price}
                error={errors.price}
              />
              <FormField
                label="Vence a los (días)"
                inputMode="numeric"
                value={form.validityDays}
                onChange={this.handleFormChange('validityDays')}
                onBlur={this.handleFormBlur('validityDays')}
                touched={touched.validityDays}
                error={errors.validityDays}
              />
            </div>
            {saveError ? <Banner type="danger">{saveError}</Banner> : null}
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <SpinnerIcon className="spin" /> : null}
              Ofrecer paquete
            </button>
          </form>
        </section>
      </>
    )
  }

  // --- Alumno ---------------------------------------------------------------

  handleAskBuy = (offer) => () => {
    this.setState({ buying: offer, buyError: null, bought: null })
  }

  handleCloseBuy = () => {
    if (!this.state.buyBusy) this.setState({ buying: null })
  }

  handleBuy = () => {
    const { buying, buyBusy } = this.state
    if (!buying || buyBusy) return
    this.setState({ buyBusy: true, buyError: null })
    buyPack(buying.id)
      .then((pack) => {
        this.setState((prev) => ({
          buyBusy: false,
          buying: null,
          bought: pack,
          myPacks: [pack, ...prev.myPacks],
        }))
      })
      .catch((error) => {
        this.setState({
          buyBusy: false,
          buyError: error.message || 'No se pudo comprar el paquete.',
        })
      })
  }

  renderMyPack(pack) {
    const usadas = pack.classCount - pack.remaining
    const estado = pack.expired
      ? `Venció el ${formatPackDate(pack.expiresOn)}`
      : `Vence el ${formatPackDate(pack.expiresOn)}`

    return (
      <li key={pack.id} className={`pack-card ${pack.expired ? 'is-expired' : ''}`}>
        <div className="pack-card-head">
          <span className="pack-card-title">con {pack.teacherName}</span>
          <span className={`pack-card-badge ${pack.expired ? 'is-muted' : ''}`}>{estado}</span>
        </div>
        <p className="pack-card-remaining">
          Te {pack.remaining === 1 ? 'queda' : 'quedan'} <strong>{classesLabel(pack.remaining)}</strong>{' '}
          de {pack.classCount}
        </p>
        <div
          className="pack-meter"
          role="img"
          aria-label={`Usaste ${usadas} de ${pack.classCount} clases`}
        >
          <span style={{ width: `${(usadas / pack.classCount) * 100}%` }} />
        </div>
        {pack.remaining > pack.available && !pack.expired ? (
          <p className="pack-card-meta">
            {classesLabel(pack.remaining - pack.available)} ya{' '}
            {pack.remaining - pack.available === 1 ? 'reservada' : 'reservadas'}, esperando la clase.
          </p>
        ) : null}
      </li>
    )
  }

  renderStudent() {
    const { myPacks, catalog, bought } = this.state

    return (
      <>
        {bought ? (
          <Banner type="success">
            Listo, compraste {classesLabel(bought.classCount)} con {bought.teacherName}. Al reservar,
            elegí usar tu paquete.{' '}
            <Link className="auth-link" to="/disponibilidad">
              Ir a reservar
            </Link>
          </Banner>
        ) : null}

        <section className="packs-section" aria-labelledby="packs-mine">
          <h2 className="packs-section-title" id="packs-mine">
            Mis paquetes
          </h2>
          {myPacks.length === 0 ? (
            <p className="packs-empty">Todavía no compraste ningún paquete.</p>
          ) : (
            <ul className="packs-list">{myPacks.map((pack) => this.renderMyPack(pack))}</ul>
          )}
        </section>

        <section className="packs-section" aria-labelledby="packs-catalog">
          <h2 className="packs-section-title" id="packs-catalog">
            Paquetes disponibles
          </h2>
          {catalog.length === 0 ? (
            <p className="packs-empty">Ningún docente ofrece paquetes por ahora.</p>
          ) : (
            <ul className="packs-list">
              {catalog.map((offer) => (
                <li key={offer.id} className="pack-card">
                  <div className="pack-card-head">
                    <span className="pack-card-title">
                      {classesLabel(offer.classCount)} con {offer.teacherName}
                    </span>
                    <span className="pack-card-price">{formatMoney(offer.priceCents)}</span>
                  </div>
                  <p className="pack-card-meta">
                    {validityLabel(offer.validityDays)} desde la compra · cualquier materia y
                    modalidad
                  </p>
                  <div className="pack-card-actions">
                    <button
                      type="button"
                      className="pack-action is-primary"
                      onClick={this.handleAskBuy(offer)}
                      aria-label={`Comprar ${classesLabel(offer.classCount)} con ${offer.teacherName}`}
                    >
                      Comprar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {this.renderBuyDialog()}
      </>
    )
  }

  renderBuyDialog() {
    const { buying, buyBusy, buyError } = this.state
    if (!buying) return null

    return (
      <Modal title="Comprar paquete" onClose={this.handleCloseBuy}>
        <p className="packs-confirm-text">
          {classesLabel(buying.classCount)} con {buying.teacherName} por{' '}
          <strong>{formatMoney(buying.priceCents)}</strong>. Vale {buying.validityDays}{' '}
          {buying.validityDays === 1 ? 'día' : 'días'} desde hoy, para cualquier materia y modalidad
          de este docente. Cada clase a la que asistas descuenta una.
        </p>
        {buyError ? <Banner type="danger">{buyError}</Banner> : null}
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={this.handleCloseBuy} disabled={buyBusy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={this.handleBuy} disabled={buyBusy}>
            {buyBusy ? <SpinnerIcon className="spin" /> : null}
            Comprar
          </button>
        </div>
      </Modal>
    )
  }

  renderBody() {
    const { loading, error } = this.state
    if (!this.props.user) {
      return (
        <div className="packs-empty">
          <p>Iniciá sesión para ver los paquetes.</p>
          <Link className="auth-link" to="/ingresar">
            Ir al login
          </Link>
        </div>
      )
    }
    if (loading) {
      return (
        <p className="packs-empty">
          <SpinnerIcon className="spin" />
          Cargando paquetes...
        </p>
      )
    }
    return (
      <>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {this.esDocente() ? this.renderTeacher() : this.renderStudent()}
      </>
    )
  }

  render() {
    return (
      <div className="packs-page">
        <h1 className="packs-title">Paquetes de clases</h1>
        <p className="packs-subtitle">
          {this.esDocente()
            ? 'Ofrecé varias clases juntas, con un precio total y una fecha de vencimiento.'
            : 'Comprá varias clases juntas con un docente y usalas cuando quieras, hasta que venza.'}
        </p>
        {this.renderBody()}
      </div>
    )
  }
}

PacksPage.defaultProps = {
  viewRole: 'student',
}

export default PacksPage

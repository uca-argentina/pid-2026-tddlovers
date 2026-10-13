import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import { PencilIcon, PinIcon, PlusIcon, SpinnerIcon, TrashIcon } from '../../components/icons.jsx'
import { deleteAddress, fetchMyAddresses, setDefaultAddress } from '../../api/client.js'
import { formatAddress } from '../../utils/addresses.js'
import AddressDialog from './AddressDialog.jsx'
import '../../components/ClassActions.css'
import './AddressesSection.css'

/**
 * Las direcciones guardadas del docente, en su perfil: agregar, editar,
 * borrar y elegir la predeterminada (la que viene elegida al cargar un
 * horario presencial).
 *
 * Cada acción se guarda al momento contra su ruta, aparte del "Guardar
 * cambios" del perfil: una dirección no es un campo más del formulario, y
 * tener que acordarse de guardar dos veces sería una trampa.
 *
 * Una dirección que usa algún horario no se puede borrar: el backend lo
 * frena y dice cuántos son, y eso se muestra tal cual.
 */
class AddressesSection extends Component {
  state = {
    addresses: [],
    loading: true,
    error: null,
    notice: null,
    // null, { address: null } para una nueva, o { address } para editar.
    dialog: null,
    confirmDeleteId: null,
    // El id de la dirección en vuelo (borrar o poner predeterminada).
    busyId: null,
  }

  token = 0

  componentDidMount() {
    this.load()
  }

  componentWillUnmount() {
    this.token += 1
  }

  load() {
    const token = ++this.token
    return fetchMyAddresses()
      .then((addresses) => {
        if (token !== this.token) return
        this.setState({ addresses: Array.isArray(addresses) ? addresses : [], loading: false })
      })
      .catch((error) => {
        if (token !== this.token) return
        this.setState({
          loading: false,
          error: error.message || 'No se pudieron cargar tus direcciones.',
        })
      })
  }

  handleAdd = () => this.setState({ dialog: { address: null }, notice: null, error: null })

  handleEdit = (address) => () => this.setState({ dialog: { address }, notice: null, error: null })

  handleCloseDialog = () => this.setState({ dialog: null })

  /**
   * Después de guardar se vuelve a pedir la lista: ponerla predeterminada
   * cambia también la que lo era, y el orden.
   */
  handleSaved = () => {
    const nueva = !this.state.dialog?.address
    this.setState({
      dialog: null,
      notice: nueva ? 'Listo, guardamos la dirección.' : 'Listo, actualizamos la dirección.',
    })
    this.load()
  }

  handleDefault = (address) => () => {
    if (this.state.busyId) return
    this.setState({ busyId: address.id, error: null, notice: null })
    setDefaultAddress(address.id)
      .then(() => this.load())
      .then(() =>
        this.setState({ busyId: null, notice: `«${address.label}» es tu dirección predeterminada.` }),
      )
      .catch((error) =>
        this.setState({ busyId: null, error: error.message || 'No se pudo cambiar la predeterminada.' }),
      )
  }

  handleAskDelete = (address) => () =>
    this.setState({ confirmDeleteId: address.id, error: null, notice: null })

  handleKeep = () => this.setState({ confirmDeleteId: null })

  handleDelete = (address) => () => {
    if (this.state.busyId) return
    this.setState({ busyId: address.id, error: null })
    deleteAddress(address.id)
      .then(() => this.load())
      .then(() =>
        this.setState({ busyId: null, confirmDeleteId: null, notice: 'Listo, borramos la dirección.' }),
      )
      .catch((error) =>
        this.setState({
          busyId: null,
          confirmDeleteId: null,
          error: error.message || 'No se pudo borrar la dirección.',
        }),
      )
  }

  renderActions(address) {
    const { busyId, confirmDeleteId } = this.state
    const ocupado = Boolean(busyId)
    const spinner = busyId === address.id ? <SpinnerIcon className="spin" /> : null

    if (confirmDeleteId === address.id) {
      return (
        <div className="addresses-actions">
          <span className="addresses-confirm">¿Borrar «{address.label}»?</span>
          <button type="button" className="class-action is-secondary" onClick={this.handleKeep}>
            No
          </button>
          <button
            type="button"
            className="class-action is-danger"
            onClick={this.handleDelete(address)}
            disabled={ocupado}
          >
            {spinner}
            Sí, borrar
          </button>
        </div>
      )
    }

    return (
      <div className="addresses-actions">
        {address.isDefault ? null : (
          <button
            type="button"
            className="class-action is-secondary"
            onClick={this.handleDefault(address)}
            disabled={ocupado}
          >
            {spinner}
            Usar como predeterminada
          </button>
        )}
        <button
          type="button"
          className="addresses-icon-button"
          onClick={this.handleEdit(address)}
          disabled={ocupado}
          aria-label={`Editar ${address.label}`}
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          className="addresses-icon-button is-danger"
          onClick={this.handleAskDelete(address)}
          disabled={ocupado}
          aria-label={`Borrar ${address.label}`}
        >
          <TrashIcon />
        </button>
      </div>
    )
  }

  renderList() {
    const { addresses, loading } = this.state
    if (loading) {
      return (
        <p className="subject-loading">
          <SpinnerIcon className="spin" />
          Cargando direcciones...
        </p>
      )
    }
    if (addresses.length === 0) {
      return (
        <p className="addresses-empty">
          Todavía no guardaste direcciones. Guardá las que uses para tus clases presenciales y
          elegilas al cargar un horario.
        </p>
      )
    }
    return (
      <ul className="addresses-list">
        {addresses.map((address) => (
          <li key={address.id} className="addresses-item">
            <span className="addresses-icon" aria-hidden="true">
              <PinIcon />
            </span>
            <div className="addresses-info">
              <span className="addresses-name">
                {address.label}
                {address.isDefault ? <span className="addresses-default">Predeterminada</span> : null}
              </span>
              <span className="addresses-line">{formatAddress(address)}</span>
            </div>
            {this.renderActions(address)}
          </li>
        ))}
      </ul>
    )
  }

  render() {
    const { error, notice, dialog } = this.state
    return (
      <div className="profile-section addresses-section">
        <div className="addresses-head">
          <h2 className="profile-section-title">Direcciones</h2>
          <button type="button" className="class-action is-secondary" onClick={this.handleAdd}>
            <PlusIcon />
            Agregar dirección
          </button>
        </div>
        {error ? <Banner type="danger">{error}</Banner> : null}
        {notice ? <Banner type="success">{notice}</Banner> : null}
        {this.renderList()}
        {dialog ? (
          <AddressDialog
            address={dialog.address}
            onClose={this.handleCloseDialog}
            onSaved={this.handleSaved}
          />
        ) : null}
      </div>
    )
  }
}

export default AddressesSection

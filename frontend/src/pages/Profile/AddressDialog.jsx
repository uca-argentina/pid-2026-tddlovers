import { Component } from 'react'
import AddressFields from '../../components/AddressFields.jsx'
import Banner from '../../components/Banner.jsx'
import Modal from '../../components/Modal.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { createAddress, updateAddress } from '../../api/client.js'
import { addressErrors, addressToForm, addressToPayload, EMPTY_ADDRESS } from '../../utils/addresses.js'

/**
 * Agregar o editar una dirección guardada. Con `address` edita esa; sin, crea
 * una nueva. Al guardar avisa con onSaved(direcciónGuardada).
 *
 * Editar una dirección cambia todos los horarios que la usan: se dice acá,
 * antes de guardar. Las clases ya reservadas no cambian (tienen su copia).
 */
class AddressDialog extends Component {
  constructor(props) {
    super(props)
    const { address } = props
    this.state = {
      form: address ? addressToForm(address) : { ...EMPTY_ADDRESS },
      isDefault: address ? address.isDefault : false,
      showErrors: false,
      saving: false,
      error: null,
    }
  }

  handleChange = (form) => this.setState({ form, error: null })

  handleDefault = (event) => this.setState({ isDefault: event.target.checked })

  handleSubmit = (event) => {
    // El modal va por portal, pero los eventos de React igual suben por el
    // árbol: sin esto, guardar la dirección mandaría también el formulario
    // del perfil que lo contiene.
    event.preventDefault()
    event.stopPropagation()
    const { form, isDefault, saving } = this.state
    if (saving) return
    if (Object.keys(addressErrors(form, { saving: true })).length > 0) {
      this.setState({ showErrors: true })
      return
    }

    this.setState({ saving: true, error: null, showErrors: true })
    const payload = { ...addressToPayload(form), isDefault }
    const pedido = this.props.address
      ? updateAddress(this.props.address.id, payload)
      : createAddress(payload)
    pedido
      .then((saved) => this.props.onSaved(saved))
      .catch((error) =>
        this.setState({
          saving: false,
          error: error.message || 'No se pudo guardar la dirección. Probá de nuevo.',
        }),
      )
  }

  render() {
    const { address, onClose } = this.props
    const { form, isDefault, showErrors, saving, error } = this.state
    // Ya predeterminada no se puede "des-predeterminar" acá: se elige otra.
    const yaPredeterminada = Boolean(address?.isDefault)

    return (
      <Modal title={address ? 'Editar dirección' : 'Nueva dirección'} onClose={onClose}>
        <form className="address-dialog" onSubmit={this.handleSubmit} noValidate>
          {address ? (
            <p className="address-dialog-note">
              Los horarios que usan esta dirección se actualizan solos. Las clases ya reservadas
              conservan la dirección que tenían.
            </p>
          ) : null}
          <AddressFields
            value={form}
            onChange={this.handleChange}
            errors={addressErrors(form, { saving: true })}
            showErrors={showErrors}
            disabled={saving}
            showLabel
          />
          <label className="address-dialog-check">
            <input
              type="checkbox"
              checked={isDefault}
              onChange={this.handleDefault}
              disabled={saving || yaPredeterminada}
            />
            <span>Usar como predeterminada para los horarios nuevos</span>
          </label>
          {error ? <Banner type="danger">{error}</Banner> : null}
          <div className="address-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? <SpinnerIcon className="spin" /> : null}
              {saving ? 'Guardando...' : 'Guardar dirección'}
            </button>
          </div>
        </form>
      </Modal>
    )
  }
}

AddressDialog.defaultProps = {
  address: null,
  onSaved: () => {},
}

export default AddressDialog

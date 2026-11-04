import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import { setAcceptsRewards } from '../../api/client.js'

/**
 * Si el docente acepta que le canjeen clases con neuronas. Se guarda al momento y
 * aparte de "Guardar cambios": guardar el perfil le vuelve a pedir aprobación a
 * un docente rechazado, y esto no cambia nada que se revise.
 */
class NeuronasSetting extends Component {
  state = { saving: false, error: null }

  handleChange = (event) => {
    const accepts = event.target.checked
    this.setState({ saving: true, error: null })
    setAcceptsRewards(accepts)
      .then(({ acceptsRewards }) => {
        this.setState({ saving: false })
        this.props.onChange?.(acceptsRewards)
      })
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo guardar. Probá de nuevo.',
        })
      })
  }

  render() {
    const { saving, error } = this.state
    return (
      <section className="profile-section">
        <h2 className="profile-section-title">Neuronas</h2>
        {error ? <Banner type="danger">{error}</Banner> : null}
        <label className="neuronas-setting">
          <input
            type="checkbox"
            checked={this.props.accepts}
            onChange={this.handleChange}
            disabled={saving}
          />
          <span>
            Aceptar canjes de neuronas
            <span className="neuronas-setting-hint">
              Los alumnos pueden pagar parte o toda la clase con neuronas, y esa parte no la cobrás.
              A cambio recibís la mitad de lo que gastaron cuando das la clase. Lo que ya está
              reservado no cambia.
            </span>
          </span>
        </label>
      </section>
    )
  }
}

NeuronasSetting.defaultProps = {
  accepts: false,
}

export default NeuronasSetting

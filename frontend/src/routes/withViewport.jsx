import { Component } from 'react'
import { matchesQuery, MOBILE_QUERY, watchQuery } from '../utils/media.js'

/**
 * Le baja a un componente la prop `mobile`: true en la interfaz de teléfono
 * (ver MOBILE_QUERY), y se actualiza sola si cambia el ancho (rotar el
 * teléfono, achicar la ventana).
 *
 * Hace falta saberlo en JS y no solo en CSS porque en el teléfono se
 * renderizan OTRAS cosas, no las mismas con otro estilo: la tira de semana en
 * vez del mes, los filtros en una hoja, el perfil como lista de iOS. Esconder
 * con display:none una versión entera dejaría dos copias de cada botón en el
 * DOM (y en los tests, que no aplican CSS).
 *
 * Es un HOC de clase, no un hook: los hooks viven solo en withRouter.jsx. En
 * jsdom no hay matchMedia, así que en los tests `mobile` es siempre false
 * (escritorio) salvo que se pase a mano.
 */
export default function withViewport(Wrapped) {
  class WithViewport extends Component {
    state = { mobile: matchesQuery(MOBILE_QUERY) }

    componentDidMount() {
      this.unwatch = watchQuery(MOBILE_QUERY, (mobile) => this.setState({ mobile }))
    }

    componentWillUnmount() {
      this.unwatch?.()
    }

    render() {
      // `mobile` explícito en las props gana: así los tests pueden pedir la
      // versión de teléfono sin simular matchMedia.
      return <Wrapped mobile={this.state.mobile} {...this.props} />
    }
  }

  WithViewport.displayName = `withViewport(${Wrapped.displayName || Wrapped.name || 'Component'})`

  return WithViewport
}

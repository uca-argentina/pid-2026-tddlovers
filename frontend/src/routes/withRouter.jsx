import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

/**
 * Puente entre react-router y nuestros class components.
 *
 * ESTE ES EL ÚNICO ARCHIVO DE LA APP QUE USA HOOKS, y es a propósito. El
 * resto son class components (la única otra excepción son los SVG de
 * icons.jsx, que son pura presentación). Se pudo sostener hasta acá porque
 * todo lo que hacía falta de react-router venía en forma de componente:
 * <Link>, <NavLink>, <Navigate>, <Route>. Pero leer un parámetro de la URL
 * (/disponibilidad/:materiaId) o navegar a mano solo existe como hook: la v7
 * de react-router no trae ni un <Route> con render prop ni el withRouter que
 * existía en la v5.
 *
 * La salida es concentrar TODOS los hooks acá: un HOC que llama a los cuatro
 * y los baja como una sola prop `router`. Los componentes que lo usan siguen
 * siendo clases y no ven un hook nunca. Si mañana hace falta otra cosa del
 * router, se agrega adentro de este objeto y no se abre un segundo archivo
 * con hooks.
 *
 * Uso:
 *   class AvailabilityPage extends Component {
 *     render() { return <h1>{this.props.router.params.materiaId}</h1> }
 *   }
 *   export default withRouter(AvailabilityPage)
 */
export default function withRouter(Wrapped) {
  function WithRouter(props) {
    const navigate = useNavigate()
    const location = useLocation()
    const params = useParams()
    const [searchParams, setSearchParams] = useSearchParams()

    // `props` va primero para que quien use el componente no pueda pisar
    // `router` sin querer, y para que las props propias (viewRole, etc.)
    // sigan llegando igual.
    return (
      <Wrapped
        {...props}
        router={{ navigate, location, params, searchParams, setSearchParams }}
      />
    )
  }

  // Para que en React DevTools y en los errores se lea
  // "withRouter(AvailabilityPage)" y no "WithRouter" a secas.
  WithRouter.displayName = `withRouter(${Wrapped.displayName || Wrapped.name || 'Component'})`

  return WithRouter
}

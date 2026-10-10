import { Component } from 'react'
import { HeartIcon } from './icons.jsx'
import { addFavoriteTeacher, removeFavoriteTeacher } from '../api/client.js'
import './FavoriteButton.css'

/**
 * El corazón para marcar o desmarcar a un docente como favorito. Hace el
 * pedido él mismo, así el tablero, el calendario, las reservas y "Mis
 * favoritos" no repiten esa lógica; quien lo usa guarda la lista y se entera
 * por `onChange` cuando el backend respondió.
 *
 * El corazón cambia apenas se toca (`pending`), sin esperar la respuesta: en
 * producción el backend puede tardar y un corazón que no reacciona parece
 * roto. Si el pedido falla vuelve a como estaba y avisa por `onError`.
 * Mientras guarda queda deshabilitado, así un doble clic no manda dos pedidos
 * opuestos.
 */
class FavoriteButton extends Component {
  // null = no hay pedido en vuelo; true/false = lo que se pidió.
  state = { pending: null }

  // Token y no un flag de "desmontado": <StrictMode> desmonta y vuelve a
  // montar la MISMA instancia en desarrollo, y un flag que queda en true
  // descartaba todas las respuestas (el favorito se guardaba pero el corazón
  // no cambiaba).
  requestToken = 0

  componentWillUnmount() {
    this.requestToken += 1
  }

  handleClick = () => {
    const { teacherId, favorite, onChange, onError } = this.props
    const next = !favorite
    const token = ++this.requestToken
    this.setState({ pending: next })
    const pedido = next ? addFavoriteTeacher(teacherId) : removeFavoriteTeacher(teacherId)
    pedido
      .then(() => {
        if (token !== this.requestToken) return
        this.setState({ pending: null })
        onChange(teacherId, next)
      })
      .catch((error) => {
        if (token !== this.requestToken) return
        this.setState({ pending: null })
        onError(error.message || 'No se pudo actualizar tus favoritos.')
      })
  }

  render() {
    const { teacherName, className } = this.props
    const { pending } = this.state
    const favorite = pending ?? this.props.favorite
    const accion = favorite ? 'Sacar de favoritos' : 'Agregar a favoritos'
    return (
      <button
        type="button"
        className={`favorite-button ${favorite ? 'is-favorite' : ''} ${className}`}
        aria-pressed={favorite}
        aria-label={`${accion} a ${teacherName}`}
        title={accion}
        disabled={pending !== null}
        onClick={this.handleClick}
      >
        <HeartIcon filled={favorite} />
      </button>
    )
  }
}

FavoriteButton.defaultProps = {
  favorite: false,
  className: '',
  onChange: () => {},
  onError: () => {},
}

export default FavoriteButton

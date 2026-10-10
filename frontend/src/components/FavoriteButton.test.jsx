import { StrictMode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FavoriteButton from './FavoriteButton.jsx'

const { addFavoriteTeacher, removeFavoriteTeacher } = vi.hoisted(() => ({
  addFavoriteTeacher: vi.fn(),
  removeFavoriteTeacher: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ addFavoriteTeacher, removeFavoriteTeacher }))

/**
 * Siempre adentro de <StrictMode>, como en main.jsx: en desarrollo desmonta y
 * vuelve a montar la misma instancia, y eso ya rompió el corazón una vez.
 */
function renderButton(props = {}) {
  return render(
    <StrictMode>
      <FavoriteButton teacherId="t1" teacherName="Laura Gómez" {...props} />
    </StrictMode>,
  )
}

/** Una promesa que el test resuelve o rechaza cuando quiere. */
function deferred() {
  let resolve
  let reject
  const promise = new Promise((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  addFavoriteTeacher.mockReset().mockResolvedValue(null)
  removeFavoriteTeacher.mockReset().mockResolvedValue(null)
})

describe('FavoriteButton', () => {
  it('avisa el cambio cuando el backend responde, también en StrictMode', async () => {
    const onChange = vi.fn()
    renderButton({ onChange })

    await userEvent.click(screen.getByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }))

    expect(addFavoriteTeacher).toHaveBeenCalledWith('t1')
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith('t1', true))
  })

  it('el corazón cambia apenas se toca, sin esperar la respuesta', async () => {
    const pedido = deferred()
    addFavoriteTeacher.mockReturnValue(pedido.promise)
    renderButton()

    await userEvent.click(screen.getByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }))

    const corazon = screen.getByRole('button', { name: 'Sacar de favoritos a Laura Gómez' })
    expect(corazon).toHaveAttribute('aria-pressed', 'true')
    // Mientras guarda no se puede volver a tocar.
    expect(corazon).toBeDisabled()
    pedido.resolve(null)
  })

  it('si falla vuelve a como estaba y avisa', async () => {
    const onChange = vi.fn()
    const onError = vi.fn()
    removeFavoriteTeacher.mockRejectedValue(new Error('Se cortó la conexión.'))
    renderButton({ favorite: true, onChange, onError })

    await userEvent.click(screen.getByRole('button', { name: 'Sacar de favoritos a Laura Gómez' }))

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Se cortó la conexión.'))
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Sacar de favoritos a Laura Gómez' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })
})

import { act, render, screen, waitFor } from '@testing-library/react'
import { Component } from 'react'
import withFavorites from './withFavorites.jsx'

const { fetchFavoriteTeachers } = vi.hoisted(() => ({ fetchFavoriteTeachers: vi.fn() }))

vi.mock('../api/client.js', () => ({ fetchFavoriteTeachers }))

// Muestra lo que le baja el HOC y expone los callbacks para llamarlos a mano.
let ultimo = null
class Espia extends Component {
  render() {
    ultimo = this.props
    const { favoriteIds, favoriteError } = this.props
    return (
      <p>
        {favoriteIds === null ? 'sin corazones' : `favoritos: ${favoriteIds.join(',')}`}
        {favoriteError ? ` · error: ${favoriteError}` : ''}
      </p>
    )
  }
}

const ConFavoritos = withFavorites(Espia)

beforeEach(() => {
  ultimo = null
  fetchFavoriteTeachers.mockReset().mockResolvedValue([{ id: 't1' }, { id: 't2' }])
})

describe('withFavorites', () => {
  it('al alumno le baja los ids de sus favoritos', async () => {
    render(<ConFavoritos viewRole="student" />)
    expect(await screen.findByText('favoritos: t1,t2')).toBeInTheDocument()
  })

  it('a un docente no le pide nada y le baja null', () => {
    render(<ConFavoritos viewRole="teacher" />)
    expect(screen.getByText('sin corazones')).toBeInTheDocument()
    expect(fetchFavoriteTeachers).not.toHaveBeenCalled()
  })

  it('si el pedido falla, null y no una lista vacía', async () => {
    fetchFavoriteTeachers.mockRejectedValue(new Error('Se cortó'))
    render(<ConFavoritos viewRole="student" />)
    await waitFor(() => expect(fetchFavoriteTeachers).toHaveBeenCalled())
    expect(screen.getByText('sin corazones')).toBeInTheDocument()
  })

  it('vuelve a pedir cuando el rol pasa a alumno', async () => {
    const { rerender } = render(<ConFavoritos viewRole="teacher" />)
    rerender(<ConFavoritos viewRole="student" />)
    expect(await screen.findByText('favoritos: t1,t2')).toBeInTheDocument()
  })

  it('el corazón actualiza la lista y limpia el error', async () => {
    render(<ConFavoritos viewRole="student" />)
    await screen.findByText('favoritos: t1,t2')

    act(() => ultimo.onFavoriteError('No se pudo'))
    expect(await screen.findByText('favoritos: t1,t2 · error: No se pudo')).toBeInTheDocument()

    act(() => ultimo.onFavoriteChange('t1', false))
    expect(await screen.findByText('favoritos: t2')).toBeInTheDocument()
  })

  it('acepta otra regla para saber si es alumno', async () => {
    const PorUsuario = withFavorites(Espia, { isStudent: (props) => props.user?.role === 'student' })
    render(<PorUsuario user={{ role: 'student' }} />)
    expect(await screen.findByText('favoritos: t1,t2')).toBeInTheDocument()
  })
})

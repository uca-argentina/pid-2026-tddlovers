import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import FavoritesPage from './FavoritesPage.jsx'

const { fetchFavoriteTeachers, removeFavoriteTeacher } = vi.hoisted(() => ({
  fetchFavoriteTeachers: vi.fn(),
  removeFavoriteTeacher: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({
  addFavoriteTeacher: vi.fn(),
  fetchFavoriteTeachers,
  removeFavoriteTeacher,
}))

// Como la devuelve GET /api/favorites.
const laura = {
  id: 't1',
  nombre: 'Laura',
  apellido: 'Gómez',
  subjects: [
    { id: 's2', name: 'Física' },
    { id: 's1', name: 'Matemática' },
  ],
}

function renderPage(viewRole = 'student') {
  return render(
    <MemoryRouter>
      <FavoritesPage viewRole={viewRole} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchFavoriteTeachers.mockReset().mockResolvedValue([laura])
  removeFavoriteTeacher.mockReset().mockResolvedValue(null)
})

describe('FavoritesPage', () => {
  it('lista los favoritos con sus materias y un atajo a sus horarios', async () => {
    renderPage()

    expect(await screen.findByText('Laura Gómez')).toBeInTheDocument()
    expect(screen.getByText('Física · Matemática')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver los horarios de Laura Gómez' })).toHaveAttribute(
      'href',
      '/disponibilidad?q=Laura%20G%C3%B3mez',
    )
  })

  it('sacar uno lo quita de la lista', async () => {
    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Sacar de favoritos a Laura Gómez' }),
    )

    expect(removeFavoriteTeacher).toHaveBeenCalledWith('t1')
    expect(await screen.findByText(/Todavía no tenés docentes favoritos/)).toBeInTheDocument()
  })

  it('sin favoritos explica cómo marcarlos', async () => {
    fetchFavoriteTeachers.mockResolvedValue([])
    renderPage()

    expect(await screen.findByText(/Marcalos con el corazón/)).toBeInTheDocument()
  })

  it('avisa si falla la carga', async () => {
    fetchFavoriteTeachers.mockRejectedValue(new Error('Se cortó la conexión.'))
    renderPage()

    expect(await screen.findByText('Se cortó la conexión.')).toBeInTheDocument()
  })

  it('un docente no tiene favoritos', () => {
    renderPage('teacher')

    expect(screen.getByText('Los docentes favoritos son para los alumnos.')).toBeInTheDocument()
    expect(fetchFavoriteTeachers).not.toHaveBeenCalled()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NavBar from './NavBar.jsx'

// NavLink explota fuera de un router, así que todo va envuelto en
// MemoryRouter — que además nos deja elegir en qué ruta "estamos".
function renderAt(path, props) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NavBar {...props} />
    </MemoryRouter>,
  )
}

describe('NavBar', () => {
  it('linkea al perfil y al calendario', () => {
    renderAt('/')
    expect(screen.getByLabelText('Mi perfil')).toHaveAttribute('href', '/perfil')
    expect(screen.getByLabelText('Mi calendario')).toHaveAttribute('href', '/')
  })

  it('marca el calendario como activo en la raíz', () => {
    renderAt('/')
    expect(screen.getByLabelText('Mi calendario')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Mi perfil')).not.toHaveAttribute('aria-current')
  })

  it('marca el perfil como activo en /perfil', () => {
    renderAt('/perfil')
    expect(screen.getByLabelText('Mi perfil')).toHaveAttribute('aria-current', 'page')
    // `end` en el NavLink de "/" es lo que evita que quede activo en todas
    // las rutas.
    expect(screen.getByLabelText('Mi calendario')).not.toHaveAttribute('aria-current')
  })

  it('tiene el buscador y refleja lo que se tipea', async () => {
    renderAt('/')
    const input = screen.getByLabelText('Buscar docentes o materias')
    await userEvent.type(input, 'álgebra')
    expect(input).toHaveValue('álgebra')
  })

  it('linkea a la disponibilidad', () => {
    renderAt('/')
    expect(screen.getByLabelText('Disponibilidad')).toHaveAttribute('href', '/disponibilidad')
  })

  it('marca disponibilidad como activa también cuando viene con materia', () => {
    // El NavLink va sin `end` justamente para esto.
    renderAt('/disponibilidad/3')
    expect(screen.getByLabelText('Disponibilidad')).toHaveAttribute('aria-current', 'page')
    expect(screen.getByLabelText('Mi calendario')).not.toHaveAttribute('aria-current')
  })
})

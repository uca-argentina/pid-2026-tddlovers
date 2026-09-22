import { Component } from 'react'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import withRouter from './withRouter.jsx'

// Un class component de prueba que solo muestra lo que le inyecta el HOC.
class Sonda extends Component {
  render() {
    const { params, location } = this.props.router
    return (
      <div>
        <span data-testid="materia">{params.materiaId}</span>
        <span data-testid="ruta">{location.pathname}</span>
        <span data-testid="extra">{this.props.extra}</span>
      </div>
    )
  }
}

const SondaConRouter = withRouter(Sonda)

function renderAt(path, props) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/materias" element={<SondaConRouter {...props} />} />
        <Route path="/materias/:materiaId" element={<SondaConRouter {...props} />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('withRouter', () => {
  it('inyecta los parámetros de la URL', () => {
    renderAt('/materias/7')
    expect(screen.getByTestId('materia')).toHaveTextContent('7')
  })

  it('deja los parámetros vacíos si la ruta no los tiene', () => {
    renderAt('/materias')
    expect(screen.getByTestId('materia')).toBeEmptyDOMElement()
  })

  it('inyecta la ubicación actual', () => {
    renderAt('/materias/3')
    expect(screen.getByTestId('ruta')).toHaveTextContent('/materias/3')
  })

  it('no se come las props propias del componente', () => {
    renderAt('/materias', { extra: 'hola' })
    expect(screen.getByTestId('extra')).toHaveTextContent('hola')
  })

  it('deja un displayName que se entiende en las herramientas', () => {
    expect(SondaConRouter.displayName).toBe('withRouter(Sonda)')
  })
})

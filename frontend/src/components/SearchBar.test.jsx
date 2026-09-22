import { Component } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SearchBar from './SearchBar.jsx'
import withRouter from '../routes/withRouter.jsx'

// Una pantalla de mentira que muestra con qué `q` llegó, para poder mirar lo
// que de verdad importa: que lo buscado viaje en la URL.
class Sonda extends Component {
  render() {
    return <p data-testid="q">{this.props.router.searchParams.get('q') || '(sin q)'}</p>
  }
}
const SondaConRouter = withRouter(Sonda)

function renderSearch() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <SearchBar />
      <Routes>
        <Route path="/" element={<p data-testid="pantalla">calendario</p>} />
        <Route
          path="/disponibilidad"
          element={
            <>
              <p data-testid="pantalla">reservar</p>
              <SondaConRouter />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  )
}

function buscar(texto) {
  return userEvent.type(screen.getByLabelText('Buscar docentes o materias'), `${texto}{Enter}`)
}

describe('SearchBar', () => {
  it('buscar lleva a la pantalla de reservar con lo buscado en la URL', async () => {
    renderSearch()

    await buscar('matemática')

    expect(screen.getByTestId('pantalla')).toHaveTextContent('reservar')
    expect(screen.getByTestId('q')).toHaveTextContent('matemática')
  })

  it('un nombre de docente viaja igual', async () => {
    renderSearch()

    await buscar('laura gómez')

    expect(screen.getByTestId('q')).toHaveTextContent('laura gómez')
  })

  it('buscar vacío lleva a reservar sin filtro', async () => {
    renderSearch()

    await buscar('   ')

    expect(screen.getByTestId('pantalla')).toHaveTextContent('reservar')
    expect(screen.getByTestId('q')).toHaveTextContent('(sin q)')
  })

  it('tipear sin enviar no navega', async () => {
    // La barra vive en todas las pantallas: buscar por tecla te sacaría del
    // calendario a la mitad de una palabra.
    renderSearch()

    await userEvent.type(screen.getByLabelText('Buscar docentes o materias'), 'mate')

    expect(screen.getByTestId('pantalla')).toHaveTextContent('calendario')
  })

  it('el texto se queda en la caja', async () => {
    renderSearch()
    const input = screen.getByLabelText('Buscar docentes o materias')

    await userEvent.type(input, 'álgebra')

    expect(input).toHaveValue('álgebra')
  })
})

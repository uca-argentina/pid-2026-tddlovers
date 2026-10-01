import { Component, StrictMode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SearchBar from './SearchBar.jsx'
import withRouter from '../routes/withRouter.jsx'

const { fetchSubjects, fetchTeachers } = vi.hoisted(() => ({
  fetchSubjects: vi.fn(),
  fetchTeachers: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ fetchSubjects, fetchTeachers }))

const MATERIAS = [
  { id: 's1', name: 'Matemática' },
  { id: 's2', name: 'Física' },
  { id: 's3', name: 'Análisis Matemático' },
]

const DOCENTES = [
  {
    id: 't1',
    nombre: 'Laura',
    apellido: 'Gómez',
    subjects: [
      { id: 's1', name: 'Matemática' },
      { id: 's2', name: 'Física' },
    ],
  },
  { id: 't2', nombre: 'Martín', apellido: 'Sosa', subjects: [{ id: 's2', name: 'Física' }] },
]

beforeEach(() => {
  fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
  fetchTeachers.mockReset().mockResolvedValue(DOCENTES)
})

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

function caja() {
  return screen.getByLabelText('Buscar docentes o materias')
}

function seccion(nombre) {
  return screen.getByRole('group', { name: nombre })
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

  describe('sugerencias', () => {
    it('separa materias y docentes, cada uno con su etiqueta', async () => {
      renderSearch()

      await userEvent.type(caja(), 'ma')

      const materias = await screen.findByRole('group', { name: 'Materias' })
      expect(within(materias).getByText('Matemática')).toBeInTheDocument()
      expect(within(materias).getByText('Análisis Matemático')).toBeInTheDocument()
      expect(within(materias).getAllByText('Materia')).toHaveLength(2)

      const docentes = seccion('Docentes')
      expect(within(docentes).getByText('Martín Sosa')).toBeInTheDocument()
      expect(within(docentes).getByText('Docente')).toBeInTheDocument()
    })

    it('muestra un docente por su apellido, con las materias que da', async () => {
      renderSearch()

      await userEvent.type(caja(), 'gómez')

      const docentes = await screen.findByRole('group', { name: 'Docentes' })
      expect(within(docentes).getByText('Laura Gómez')).toBeInTheDocument()
      expect(within(docentes).getByText('Matemática · Física')).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Materias' })).not.toBeInTheDocument()
    })

    it('no corta en tres: el resto queda en el scroll de la sección', async () => {
      fetchSubjects.mockResolvedValue(
        ['Mate I', 'Mate II', 'Mate III', 'Mate IV', 'Mate V'].map((name, i) => ({
          id: `m${i}`,
          name,
        })),
      )
      renderSearch()

      await userEvent.type(caja(), 'mate')

      const materias = await screen.findByRole('group', { name: 'Materias' })
      expect(within(materias).getAllByRole('option')).toHaveLength(5)
    })

    it('elegir una materia lleva a reservar con esa materia', async () => {
      renderSearch()

      await userEvent.type(caja(), 'fís')
      await userEvent.click(await screen.findByText('Física'))

      expect(screen.getByTestId('pantalla')).toHaveTextContent('reservar')
      expect(screen.getByTestId('q')).toHaveTextContent('Física')
      expect(caja()).toHaveValue('Física')
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    })

    it('elegir un docente lleva a reservar con su nombre completo', async () => {
      renderSearch()

      await userEvent.type(caja(), 'sosa')
      await userEvent.click(await screen.findByText('Martín Sosa'))

      expect(screen.getByTestId('q')).toHaveTextContent('Martín Sosa')
    })

    it('se elige con las flechas y Enter', async () => {
      renderSearch()

      await userEvent.type(caja(), 'ma')
      await screen.findByRole('group', { name: 'Materias' })
      // Materias primero y docentes después: la tercera es el primer docente.
      await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}')

      expect(screen.getByTestId('q')).toHaveTextContent('Martín Sosa')
    })

    it('Escape cierra la lista sin navegar', async () => {
      renderSearch()

      await userEvent.type(caja(), 'ma')
      await screen.findByRole('listbox')
      await userEvent.keyboard('{Escape}')

      expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
      expect(screen.getByTestId('pantalla')).toHaveTextContent('calendario')
    })

    it('si los docentes no cargan, igual sugiere materias', async () => {
      fetchTeachers.mockRejectedValue(new Error('401'))
      renderSearch()

      await userEvent.type(caja(), 'ma')

      expect(await screen.findByRole('group', { name: 'Materias' })).toBeInTheDocument()
      expect(screen.queryByRole('group', { name: 'Docentes' })).not.toBeInTheDocument()
    })

    it('sin coincidencias lo dice', async () => {
      renderSearch()

      await userEvent.type(caja(), 'zzz')

      expect(
        await screen.findByText('No encontramos materias ni docentes para “zzz”.'),
      ).toBeInTheDocument()
    })

    it('funciona bajo StrictMode, que en dev desmonta y vuelve a montar', async () => {
      // main.jsx envuelve la app en StrictMode: React monta, desmonta y
      // vuelve a montar la MISMA instancia, y una guarda de "ya me desmonté"
      // que no se resetea tiraba a la basura el catálogo.
      render(
        <StrictMode>
          <MemoryRouter initialEntries={['/']}>
            <SearchBar />
          </MemoryRouter>
        </StrictMode>,
      )

      await userEvent.type(caja(), 'fís')

      expect(await screen.findByText('Física')).toBeInTheDocument()
    })

    it('el catálogo se pide una sola vez', async () => {
      renderSearch()

      await userEvent.type(caja(), 'ma')
      await userEvent.tab()
      await userEvent.click(caja())

      expect(fetchSubjects).toHaveBeenCalledTimes(1)
      expect(fetchTeachers).toHaveBeenCalledTimes(1)
    })
  })
})

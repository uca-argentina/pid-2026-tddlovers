import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import AvailabilityPage from './AvailabilityPage.jsx'

// Ojo: vi.mock con factory reemplaza el módulo ENTERO, así que todo lo que
// importe cualquier pantalla de esta ruta tiene que estar acá — la del alumno
// pide fetchAvailability y fetchMyLessons.
const {
  fetchAvailability,
  fetchAvailabilityByTeacher,
  fetchMyLessons,
  fetchSubjects,
  saveAvailability,
} = vi.hoisted(() => ({
  fetchAvailability: vi.fn(),
  fetchAvailabilityByTeacher: vi.fn(),
  fetchMyLessons: vi.fn(),
  fetchSubjects: vi.fn(),
  saveAvailability: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({
  fetchAvailability,
  fetchAvailabilityByTeacher,
  fetchMyLessons,
  fetchSubjects,
  saveAvailability,
}))

const MATERIAS = [
  { id: 1, name: 'Matemática' },
  { id: 3, name: 'Álgebra' },
  { id: 5, name: 'Programación' },
]

const docente = { id: 1, nombre: 'Agustín', role: 'teacher', subjectIds: [1, 3, 5] }
const alumno = { id: 7, nombre: 'Sofía', role: 'student', subjectIds: [] }

function renderAt(path, props) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/disponibilidad" element={<AvailabilityPage {...props} />} />
        <Route path="/disponibilidad/:materiaId" element={<AvailabilityPage {...props} />} />
      </Routes>
    </MemoryRouter>,
  )
}

// La carga llega por promesa: esperarla evita que el setState caiga fuera del
// test (el warning de act()).
function esperarCarga() {
  return waitFor(() => expect(screen.queryByText('Cargando tus horarios...')).not.toBeInTheDocument())
}

describe('AvailabilityPage — vista de alumno', () => {
  beforeEach(() => {
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    fetchAvailability.mockReset().mockResolvedValue([])
    fetchMyLessons.mockReset().mockResolvedValue([])
  })

  function esperarTablero() {
    return waitFor(() =>
      expect(screen.queryByText('Buscando horarios...')).not.toBeInTheDocument(),
    )
  }

  it('muestra el tablero para reservar, no el placeholder', async () => {
    renderAt('/disponibilidad', { viewRole: 'student', user: alumno })
    await esperarTablero()

    expect(screen.getByText('Días')).toBeInTheDocument()
    expect(screen.queryByText('Todavía está en construcción.')).not.toBeInTheDocument()
  })

  it('pide la disponibilidad del rango que muestra la grilla', async () => {
    renderAt('/disponibilidad', { viewRole: 'student', user: alumno })
    await esperarTablero()

    expect(fetchAvailability).toHaveBeenCalledTimes(1)
    const { from, to } = fetchAvailability.mock.calls[0][0]
    expect(from < to).toBe(true)
  })

  it('sin usuario no pide las clases propias', async () => {
    // Las rutas no tienen portero: un alumno deslogueado igual puede mirar.
    renderAt('/disponibilidad', { viewRole: 'student', user: null })
    await esperarTablero()

    expect(fetchAvailability).toHaveBeenCalled()
    expect(fetchMyLessons).not.toHaveBeenCalled()
  })

  it('la materia de la URL queda elegida', async () => {
    renderAt('/disponibilidad/1', { viewRole: 'student', user: alumno })
    await esperarTablero()

    expect(await screen.findByRole('button', { name: 'Matemática' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('avisa si falla la carga', async () => {
    fetchAvailability.mockRejectedValue(new Error('Se cayó todo.'))
    renderAt('/disponibilidad', { viewRole: 'student', user: alumno })

    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })
})

describe('AvailabilityPage — vista de docente', () => {
  beforeEach(() => {
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    fetchAvailability.mockReset().mockResolvedValue([])
    fetchMyLessons.mockReset().mockResolvedValue([])
    saveAvailability.mockReset().mockResolvedValue({})
    fetchAvailabilityByTeacher.mockReset().mockResolvedValue({
      1: { lunes: [{ start: '09:00', end: '11:00' }] },
      5: { viernes: [{ start: '14:00', end: '15:00' }] },
    })
  })

  it('sin materia muestra el elegidor, no el placeholder', async () => {
    renderAt('/disponibilidad', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    expect(await screen.findByText(/Elegí una materia/)).toBeInTheDocument()
    expect(screen.queryByText('Todavía está en construcción.')).not.toBeInTheDocument()
  })

  it('el elegidor lista solo las materias del docente y linkea a cada una', async () => {
    renderAt('/disponibilidad', {
      viewRole: 'teacher',
      user: { ...docente, subjectIds: [1, 3] },
    })
    await esperarCarga()

    expect(screen.getByRole('link', { name: /Matemática/ })).toHaveAttribute(
      'href',
      '/disponibilidad/1',
    )
    expect(screen.getByRole('link', { name: /Álgebra/ })).toHaveAttribute(
      'href',
      '/disponibilidad/3',
    )
    expect(screen.queryByRole('link', { name: /Programación/ })).not.toBeInTheDocument()
  })

  it('el elegidor dice cuántas horas tiene cargada cada materia', async () => {
    renderAt('/disponibilidad', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    // Matemática tiene 09:00–11:00 = 2 h; Álgebra no tiene nada.
    expect(screen.getByRole('link', { name: /Matemática/ })).toHaveTextContent('2 h')
    expect(screen.getByRole('link', { name: /Álgebra/ })).toHaveTextContent('0 min')
  })

  it('carga y dibuja el horario guardado de la materia', async () => {
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    expect(await screen.findByText('Disponibilidad de Matemática')).toBeInTheDocument()
    // El bloque fusionado de las 09:00 a las 11:00.
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
  })

  it('los horarios de OTRAS materias se ven ocupados y dicen de cuál son', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    // Editando Álgebra, lo de Matemática y lo de Programación está ocupado.
    expect(screen.getByLabelText('Lunes 09:00, ocupado por Matemática')).toBeInTheDocument()
    expect(screen.getByLabelText('Viernes 14:00, ocupado por Programación')).toBeInTheDocument()
  })

  it('los horarios de la materia que se edita NO se ven ocupados', async () => {
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    expect(screen.getByLabelText('Lunes 09:00, disponible')).toBeInTheDocument()
    expect(screen.queryByLabelText(/ocupado por Matemática/)).not.toBeInTheDocument()
  })

  it('tiene una flecha para volver al perfil', async () => {
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    expect(screen.getByLabelText('Volver al perfil')).toHaveAttribute('href', '/perfil')
  })

  it('el elegidor no tiene flecha: ya está en el listado', async () => {
    renderAt('/disponibilidad', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    expect(screen.queryByLabelText('Volver al perfil')).not.toBeInTheDocument()
  })

  it('guardar arranca apagado y se prende al tocar una celda', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    const guardar = screen.getByRole('button', { name: 'Guardar cambios' })
    expect(guardar).toBeDisabled()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    expect(guardar).toBeEnabled()
  })

  it('guarda los rangos colapsados', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByLabelText('Martes 10:30'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(1))
    expect(saveAvailability).toHaveBeenCalledWith(
      '3',
      { martes: [{ start: '10:00', end: '11:00' }] },
    )
    expect(await screen.findByText('Listo, guardamos tus horarios.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('cancelar vuelve a lo cargado', async () => {
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    expect(screen.getByLabelText('Martes 10:00, disponible sin guardar')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.getByLabelText('Martes 10:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
  })

  it('avisa si falla la carga', async () => {
    fetchAvailabilityByTeacher.mockRejectedValue(new Error('Se cayó todo.'))
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })

    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })

  it('avisa si falla el guardado', async () => {
    saveAvailability.mockRejectedValue(new Error('No se pudo.'))
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    // Una hora entera: si no, la validación corta antes de llamar al backend.
    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByLabelText('Martes 10:30'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo.')
  })

  it('avisa si el docente no da esa materia', async () => {
    renderAt('/disponibilidad/3', {
      viewRole: 'teacher',
      user: { ...docente, subjectIds: [1] },
    })
    await esperarCarga()

    expect(await screen.findByText('No estás dando esa materia.')).toBeInTheDocument()
  })

  it('cambiar de materia en la URL vuelve a pedir los datos', async () => {
    // React Router reusa la instancia entre /disponibilidad/1 y
    // /disponibilidad/3: sin el componentDidUpdate se vería el horario de una
    // diciendo que es de la otra.
    // Hay que navegar de verdad: `initialEntries` solo se lee al montar, así
    // que volver a renderizar con otra ruta no mueve nada.
    render(
      <MemoryRouter initialEntries={['/disponibilidad/1']}>
        <Link to="/disponibilidad/3">Ir a Álgebra</Link>
        <Routes>
          <Route
            path="/disponibilidad/:materiaId"
            element={<AvailabilityPage viewRole="teacher" user={docente} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await esperarCarga()
    expect(fetchAvailabilityByTeacher).toHaveBeenCalledTimes(1)

    await userEvent.click(screen.getByRole('link', { name: 'Ir a Álgebra' }))

    await waitFor(() => expect(fetchAvailabilityByTeacher).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Disponibilidad de Álgebra')).toBeInTheDocument()
  })

  it('no guarda una media hora suelta y dice cuál es', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    expect(saveAvailability).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se puede guardar: Martes 10:00 – 10:30 dura media hora, y las clases duran 1 hora.',
    )
  })

  it('antes de intentar guardar no marca nada', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector('.sched-block.is-invalid')).toBeNull()
  })

  it('el aviso se borra solo al completar la hora', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(document.querySelector('.sched-block.is-invalid')).not.toBeNull()

    await userEvent.click(screen.getByLabelText('Martes 10:30'))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(document.querySelector('.sched-block.is-invalid')).toBeNull()
  })

  it('1 h 30 se guarda: no tiene que ser múltiplo de la clase', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByLabelText('Martes 10:30'))
    await userEvent.click(screen.getByLabelText('Martes 11:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))

    await waitFor(() => expect(saveAvailability).toHaveBeenCalledTimes(1))
    expect(saveAvailability).toHaveBeenCalledWith(
      '3',
      { martes: [{ start: '10:00', end: '11:30' }] },
    )
  })

  it('cancelar borra el aviso', async () => {
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente })
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('cambiar de materia empieza sin aviso', async () => {
    render(
      <MemoryRouter initialEntries={['/disponibilidad/3']}>
        <Link to="/disponibilidad/1">Ir a Matemática</Link>
        <Routes>
          <Route
            path="/disponibilidad/:materiaId"
            element={<AvailabilityPage viewRole="teacher" user={docente} />}
          />
        </Routes>
      </MemoryRouter>,
    )
    await esperarCarga()

    await userEvent.click(screen.getByLabelText('Martes 10:00'))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Ir a Matemática' }))
    await esperarCarga()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('sin usuario pide iniciar sesión', () => {
    renderAt('/disponibilidad/1', { viewRole: 'teacher', user: null })
    expect(screen.getByText('Iniciá sesión para cargar tu disponibilidad.')).toBeInTheDocument()
    expect(fetchAvailabilityByTeacher).not.toHaveBeenCalled()
  })
})

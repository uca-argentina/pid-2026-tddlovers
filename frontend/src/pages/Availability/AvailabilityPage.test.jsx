import { StrictMode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AvailabilityPage from './AvailabilityPage.jsx'
import { addDays, toISODate } from '../../utils/calendar.js'
import { startOfWeek } from '../../utils/windows.js'

// Ojo: vi.mock con factory reemplaza el módulo ENTERO, así que todo lo que
// importe cualquier pantalla de esta ruta tiene que estar acá — la del alumno
// pide fetchAvailability y fetchMyLessons.
const {
  createWindow,
  deleteWindow,
  fetchAvailability,
  fetchMyLessons,
  fetchMyWindows,
  fetchSubjects,
  updateWindow,
} = vi.hoisted(() => ({
  createWindow: vi.fn(),
  deleteWindow: vi.fn(),
  fetchAvailability: vi.fn(),
  fetchMyLessons: vi.fn(),
  fetchMyWindows: vi.fn(),
  fetchSubjects: vi.fn(),
  updateWindow: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({
  createWindow,
  deleteWindow,
  fetchAvailability,
  fetchMyLessons,
  fetchMyWindows,
  fetchSubjects,
  updateWindow,
}))

const MATERIAS = [
  { id: 1, name: 'Matemática' },
  { id: 3, name: 'Álgebra' },
  { id: 5, name: 'Programación' },
]

const docente = { id: 1, nombre: 'Agustín', role: 'teacher', subjectIds: [1, 3, 5] }
const alumno = { id: 7, nombre: 'Sofía', role: 'student', subjectIds: [] }

// Todo se arma sobre HOY: es la semana que la pantalla muestra al entrar.
const HOY = toISODate(new Date())
const LUNES = startOfWeek(new Date())

const ventana = (over = {}) => ({
  id: 'w1',
  teacherId: 1,
  date: HOY,
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  subjectId: 1,
  subjectName: 'Matemática',
  durationMinutes: 60,
  price: 15000,
  modality: 'virtual',
  maxStudents: 1,
  meetingUrl: 'https://meet.example.com/abc',
  address: null,
  ...over,
})

// Con StrictMode, igual que main.jsx: en desarrollo React desmonta y vuelve a
// montar cada componente una vez, y un flag de "ya me desmonté" que no se
// resetea deja la pantalla sin actualizar (pasó con el modal del día).
function renderAt(path, props, { strict = true } = {}) {
  const arbol = (
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/disponibilidad" element={<AvailabilityPage {...props} />} />
        <Route path="/disponibilidad/:materiaId" element={<AvailabilityPage {...props} />} />
      </Routes>
    </MemoryRouter>
  )
  return render(strict ? <StrictMode>{arbol}</StrictMode> : arbol)
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

  it('muestra el tablero para reservar', async () => {
    renderAt('/disponibilidad', { viewRole: 'student', user: alumno })
    await esperarTablero()

    expect(screen.getByText('Días')).toBeInTheDocument()
    expect(fetchMyWindows).not.toHaveBeenCalled()
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
})

describe('AvailabilityPage — vista de docente', () => {
  beforeEach(() => {
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    fetchMyWindows.mockReset().mockResolvedValue([ventana()])
    createWindow.mockReset().mockResolvedValue(ventana({ id: 'w2' }))
    updateWindow.mockReset().mockResolvedValue(ventana())
    deleteWindow.mockReset().mockResolvedValue(null)
  })

  async function entrar(user = docente) {
    renderAt('/disponibilidad', { viewRole: 'teacher', user })
    await waitFor(() => expect(fetchMyWindows).toHaveBeenCalled())
  }

  /**
   * "Agregar clase" de la página abre el modal en hoy, y el formulario se
   * abre con el "Agregar clase" de adentro del modal.
   */
  async function abrirFormulario() {
    await userEvent.click(screen.getByRole('button', { name: 'Agregar clase' }))
    const modal = screen.getByRole('dialog', { name: 'Clases del día' })
    await userEvent.click(within(modal).getByRole('button', { name: 'Agregar clase' }))
    return modal
  }

  /** El slider va de a media hora: 16:00 es el paso 32. */
  function moverHorario(modal, desde, hasta) {
    const paso = (hora) => String(Number(hora.slice(0, 2)) * 2 + (hora.endsWith(':30') ? 1 : 0))
    // Primero el fin: las manijas no se cruzan, y el inicio no puede pasar
    // del fin que había.
    fireEvent.change(within(modal).getByLabelText('Hasta'), { target: { value: paso(hasta) } })
    fireEvent.change(within(modal).getByLabelText('Desde'), { target: { value: paso(desde) } })
  }

  function bloque() {
    return screen.findByRole('button', { name: /^Matemática, 13:00 a 15:00/ })
  }

  it('pide las ventanas de la semana actual, de lunes a domingo', async () => {
    await entrar()

    expect(fetchMyWindows).toHaveBeenCalledWith({
      from: toISODate(LUNES),
      to: toISODate(addDays(LUNES, 6)),
    })
  })

  it('muestra cada ventana como un bloque en su día', async () => {
    await entrar()

    expect(await bloque()).toHaveAccessibleName(
      /^Matemática, 13:00 a 15:00, virtual, individual, \$\s15\.000$/,
    )
  })

  it('una ventana semanal aparece también en las semanas siguientes', async () => {
    fetchMyWindows.mockResolvedValue([ventana({ repeatsWeekly: true })])
    await entrar()
    await bloque()

    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))

    await waitFor(() =>
      expect(fetchMyWindows).toHaveBeenLastCalledWith({
        from: toISODate(addDays(LUNES, 7)),
        to: toISODate(addDays(LUNES, 13)),
      }),
    )
    expect(await bloque()).toHaveAccessibleName(/se repite todas las semanas/)
  })

  it('tocar un bloque abre el modal del día con su tarjeta', async () => {
    await entrar()
    await userEvent.click(await bloque())

    const modal = screen.getByRole('dialog', { name: 'Clases del día' })
    expect(within(modal).getByText('Matemática')).toBeInTheDocument()
    expect(within(modal).getByText('13:00 – 15:00')).toBeInTheDocument()
    expect(within(modal).getByText('Clases de 1 h')).toBeInTheDocument()
    expect(within(modal).getByText(/15\.000/)).toBeInTheDocument()
    expect(within(modal).getByRole('link', { name: 'https://meet.example.com/abc' })).toBeInTheDocument()
  })

  it('"Agregar clase" abre el modal en hoy, con sus clases y sin formulario', async () => {
    await entrar()
    await bloque()

    await userEvent.click(screen.getByRole('button', { name: 'Agregar clase' }))

    const modal = screen.getByRole('dialog', { name: 'Clases del día' })
    expect(within(modal).getByText('Hoy')).toBeInTheDocument()
    expect(within(modal).getByText('Matemática')).toBeInTheDocument()
    expect(within(modal).queryByText('Nueva clase')).not.toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Agregar clase' })).toBeInTheDocument()
  })

  it('agregar una clase la manda con todos los campos y recarga la semana', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.selectOptions(within(modal).getByLabelText('Materia'), 'Álgebra')
    moverHorario(modal, '16:00', '19:30')
    expect(within(modal).getByText('El horario dura 3 h 30 min.', { exact: false })).toBeInTheDocument()
    await userEvent.clear(within(modal).getByLabelText('Cada clase dura'))
    await userEvent.type(within(modal).getByLabelText('Cada clase dura'), '45')
    await userEvent.type(within(modal).getByLabelText('Precio por clase'), '12.500')
    await userEvent.click(within(modal).getByRole('button', { name: 'Presencial' }))
    await userEvent.type(within(modal).getByLabelText('Dirección'), 'Aula 3')
    await userEvent.click(within(modal).getByRole('button', { name: 'Grupal' }))
    await userEvent.click(within(modal).getByRole('checkbox'))
    const pedidosAntes = fetchMyWindows.mock.calls.length
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(createWindow).toHaveBeenCalledTimes(1))
    expect(createWindow).toHaveBeenCalledWith({
      date: HOY,
      repeatsWeekly: true,
      start: '16:00',
      end: '19:30',
      subjectId: '3',
      durationMinutes: 45,
      price: 12500,
      modality: 'in_person',
      maxStudents: 2,
      meetingUrl: '',
      address: 'Aula 3',
    })
    expect(await within(modal).findByText('Listo, agregamos la clase.')).toBeInTheDocument()
    // Una recarga de la semana después de guardar.
    expect(fetchMyWindows).toHaveBeenCalledTimes(pedidosAntes + 1)
    // Guardada, el formulario se cierra: queda la tarjeta nueva, no las dos.
    expect(within(modal).queryByText('Nueva clase')).not.toBeInTheDocument()
    expect(within(modal).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('no deja guardar una duración que no entra en el horario, ni sin precio', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.selectOptions(within(modal).getByLabelText('Materia'), 'Matemática')
    await userEvent.clear(within(modal).getByLabelText('Cada clase dura'))
    await userEvent.type(within(modal).getByLabelText('Cada clase dura'), '90')
    await userEvent.type(
      within(modal).getByLabelText('Link de la videollamada'),
      'https://meet.example.com/x',
    )
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(within(modal).getByText('No entra en el horario, que dura 1 h.')).toBeInTheDocument()
    expect(within(modal).getByText('Poné el precio (0 si es sin cargo).')).toBeInTheDocument()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('no manda una clase virtual sin link', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.selectOptions(within(modal).getByLabelText('Materia'), 'Matemática')
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(within(modal).getByText('Pegá el link de la videollamada.')).toBeInTheDocument()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('muestra el error del backend al guardar', async () => {
    createWindow.mockRejectedValue(new Error('Se pisa con otra clase tuya de 13:00 a 15:00.'))
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.selectOptions(within(modal).getByLabelText('Materia'), 'Matemática')
    await userEvent.type(within(modal).getByLabelText('Precio por clase'), '15000')
    await userEvent.type(
      within(modal).getByLabelText('Link de la videollamada'),
      'https://meet.example.com/x',
    )
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(await within(modal).findByRole('alert')).toHaveTextContent(
      'Se pisa con otra clase tuya de 13:00 a 15:00.',
    )
  })

  it('editar una clase la manda con su id', async () => {
    await entrar()
    await userEvent.click(await bloque())
    const modal = screen.getByRole('dialog', { name: 'Clases del día' })

    await userEvent.click(within(modal).getByRole('button', { name: /^Editar la clase/ }))
    await userEvent.click(within(modal).getByRole('button', { name: 'Híbrida' }))
    await userEvent.type(within(modal).getByLabelText('Dirección'), 'Aula 3')
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(updateWindow).toHaveBeenCalledTimes(1))
    expect(updateWindow).toHaveBeenCalledWith(
      'w1',
      expect.objectContaining({
        price: 15000,
        durationMinutes: 60,
        modality: 'hybrid',
        meetingUrl: 'https://meet.example.com/abc',
        address: 'Aula 3',
      }),
    )
  })

  it('eliminar pide confirmación, y si se repite avisa que es de todas las semanas', async () => {
    fetchMyWindows.mockResolvedValue([ventana({ repeatsWeekly: true })])
    await entrar()
    await userEvent.click(await bloque())
    const modal = screen.getByRole('dialog', { name: 'Clases del día' })

    await userEvent.click(within(modal).getByRole('button', { name: /^Eliminar la clase/ }))
    expect(within(modal).getByText(/Se borra de todas las semanas/)).toBeInTheDocument()
    expect(deleteWindow).not.toHaveBeenCalled()

    await userEvent.click(within(modal).getByRole('button', { name: 'Sí, eliminar' }))
    await waitFor(() => expect(deleteWindow).toHaveBeenCalledWith('w1'))
  })

  it('las flechas del modal pasan de día', async () => {
    await entrar()
    await userEvent.click(await bloque())
    const modal = screen.getByRole('dialog', { name: 'Clases del día' })
    expect(within(modal).getByText('Hoy')).toBeInTheDocument()

    await userEvent.click(within(modal).getByRole('button', { name: 'Día siguiente' }))

    expect(within(modal).queryByText('Hoy')).not.toBeInTheDocument()
    // La ventana es de hoy y no se repite: mañana no hay nada. Si mañana cae
    // en la semana siguiente, la de atrás la sigue y se recarga.
    expect(await within(modal).findByText('No ofrecés clases este día.')).toBeInTheDocument()
  })

  it('un día que ya pasó se ve pero no se toca', async () => {
    await entrar()
    await userEvent.click(await bloque())
    const modal = screen.getByRole('dialog', { name: 'Clases del día' })

    await userEvent.click(within(modal).getByRole('button', { name: 'Día anterior' }))

    expect(await within(modal).findByText('Ya pasó')).toBeInTheDocument()
    expect(within(modal).queryByRole('button', { name: 'Agregar clase' })).not.toBeInTheDocument()
  })

  it('sin materias no deja agregar clases y manda al perfil', async () => {
    await entrar({ ...docente, subjectIds: [] })

    expect(screen.getByRole('button', { name: 'Agregar clase' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Agregalas desde tu perfil' })).toHaveAttribute(
      'href',
      '/perfil',
    )
  })

  it('avisa si falla la carga', async () => {
    fetchMyWindows.mockRejectedValue(new Error('Se cayó todo.'))
    await entrar()

    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })

  it('una URL vieja con materia se limpia y pide una sola vez', async () => {
    // Sin StrictMode: acá se cuentan pedidos, y en StrictMode montar dos
    // veces pide dos veces.
    renderAt('/disponibilidad/3', { viewRole: 'teacher', user: docente }, { strict: false })

    await bloque()
    expect(fetchMyWindows).toHaveBeenCalledTimes(1)
  })

  it('sin sesión pide iniciarla', () => {
    renderAt('/disponibilidad', { viewRole: 'teacher', user: null })

    expect(screen.getByText('Iniciá sesión para cargar tu disponibilidad.')).toBeInTheDocument()
    expect(fetchMyWindows).not.toHaveBeenCalled()
  })
})

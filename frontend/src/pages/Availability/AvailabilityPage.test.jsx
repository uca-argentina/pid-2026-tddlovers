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

// Matemática y Álgebra virtuales, Álgebra también presencial. Nada híbrido.
const docente = {
  id: 1,
  nombre: 'Agustín',
  role: 'teacher',
  subjectIds: [1, 3, 5],
  rates: [
    { subjectId: 1, modality: 'virtual', hourlyRateCents: 500000 },
    { subjectId: 3, modality: 'virtual', hourlyRateCents: 600000 },
    { subjectId: 3, modality: 'in_person', hourlyRateCents: 750050 },
  ],
}
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
   * "Agregar horario" de la página abre el modal en hoy, y el formulario se
   * abre con el "Agregar horario" de adentro del modal.
   */
  async function abrirFormulario() {
    await userEvent.click(screen.getByRole('button', { name: 'Agregar horario' }))
    const modal = screen.getByRole('dialog', { name: 'Horarios del día' })
    await userEvent.click(within(modal).getByRole('button', { name: 'Agregar horario' }))
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
    return screen.findByRole('button', { name: /^13:00 a 15:00/ })
  }

  function abrirModalDelBloque() {
    return bloque()
      .then((boton) => userEvent.click(boton))
      .then(() => screen.getByRole('dialog', { name: 'Horarios del día' }))
  }

  it('pide las ventanas de la semana actual, de lunes a domingo', async () => {
    await entrar()

    expect(fetchMyWindows).toHaveBeenCalledWith({
      from: toISODate(LUNES),
      to: toISODate(addDays(LUNES, 6)),
    })
  })

  it('muestra cada ventana como un bloque en su día, sin materia ni precio', async () => {
    await entrar()

    expect(await bloque()).toHaveAccessibleName('13:00 a 15:00, virtual, individual')
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

  it('la tarjeta dice qué materias puede elegir el alumno, con su tarifa', async () => {
    await entrar()
    const modal = await abrirModalDelBloque()

    expect(within(modal).getByText('13:00 – 15:00')).toBeInTheDocument()
    // Las de la modalidad de la ventana (virtual), no las presenciales.
    expect(
      within(modal).getByText(/^Álgebra \(\$\s6\.000\/h\), Matemática \(\$\s5\.000\/h\)$/),
    ).toBeInTheDocument()
    expect(within(modal).getByRole('link', { name: 'https://meet.example.com/abc' })).toBeInTheDocument()
  })

  it('una ventana de una modalidad sin tarifas avisa que no se ofrece', async () => {
    fetchMyWindows.mockResolvedValue([
      ventana({ modality: 'hybrid', locality: 'Palermo', address: 'Aula 3' }),
    ])
    await entrar()
    const modal = await abrirModalDelBloque()

    expect(
      within(modal).getByText(/No tenés tarifas para clases híbridas: los alumnos no ven este horario/),
    ).toBeInTheDocument()
  })

  it('"Agregar horario" abre el modal en hoy, con sus horarios y sin formulario', async () => {
    await entrar()
    await bloque()

    await userEvent.click(screen.getByRole('button', { name: 'Agregar horario' }))

    const modal = screen.getByRole('dialog', { name: 'Horarios del día' })
    expect(within(modal).getByText('Hoy')).toBeInTheDocument()
    expect(within(modal).getByText('13:00 – 15:00')).toBeInTheDocument()
    expect(within(modal).queryByText('Nuevo horario')).not.toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Agregar horario' })).toBeInTheDocument()
  })

  it('el formulario no pide materia, duración ni precio', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    expect(within(modal).queryByLabelText('Materia')).not.toBeInTheDocument()
    expect(within(modal).queryByLabelText('Cada clase dura')).not.toBeInTheDocument()
    expect(within(modal).queryByLabelText('Precio por clase')).not.toBeInTheDocument()
    expect(
      within(modal).getByText(/Los alumnos eligen entre: Álgebra \(\$\s6\.000\/h\), Matemática/),
    ).toBeInTheDocument()
  })

  it('agregar un horario lo manda con todos los campos y recarga la semana', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    moverHorario(modal, '16:00', '19:30')
    expect(within(modal).getByText(/^3 h 30 min disponibles/)).toBeInTheDocument()
    await userEvent.click(within(modal).getByRole('button', { name: 'Presencial' }))
    // En presencial solo tiene Álgebra.
    expect(within(modal).getByText(/Los alumnos eligen entre: Álgebra \(\$\s7\.500,50\/h\)\./))
      .toBeInTheDocument()
    await userEvent.type(within(modal).getByLabelText('Localidad'), 'Palermo, CABA')
    await userEvent.type(within(modal).getByLabelText('Dirección exacta'), 'Aula 3')
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
      modality: 'in_person',
      maxStudents: 2,
      meetingUrl: '',
      locality: 'Palermo, CABA',
      address: 'Aula 3',
    })
    expect(await within(modal).findByText('Listo, agregamos el horario.')).toBeInTheDocument()
    // Una recarga de la semana después de guardar.
    expect(fetchMyWindows).toHaveBeenCalledTimes(pedidosAntes + 1)
    // Guardado, el formulario se cierra: queda la tarjeta nueva, no las dos.
    expect(within(modal).queryByText('Nuevo horario')).not.toBeInTheDocument()
    expect(within(modal).queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument()
  })

  it('no deja guardar en una modalidad sin tarifas y manda al perfil', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.click(within(modal).getByRole('button', { name: 'Híbrida' }))
    expect(within(modal).getByText(/No tenés tarifas para clases híbridas\./)).toBeInTheDocument()
    expect(within(modal).getByRole('link', { name: 'Cargalas en tu perfil' })).toHaveAttribute(
      'href',
      '/perfil',
    )
    await userEvent.type(within(modal).getByLabelText('Link de la videollamada'), 'https://x.com/a')
    await userEvent.type(within(modal).getByLabelText('Localidad'), 'Palermo, CABA')
    await userEvent.type(within(modal).getByLabelText('Dirección exacta'), 'Aula 3')
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(createWindow).not.toHaveBeenCalled()
  })

  it('si solo tiene tarifas presenciales, el formulario arranca en presencial', async () => {
    await entrar({
      ...docente,
      rates: [{ subjectId: 3, modality: 'in_person', hourlyRateCents: 100000 }],
    })
    await bloque()
    const modal = await abrirFormulario()

    expect(within(modal).getByRole('button', { name: 'Presencial' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('no manda un horario virtual sin link', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(within(modal).getByText('Pegá el link de la videollamada.')).toBeInTheDocument()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('muestra el error del backend al guardar', async () => {
    createWindow.mockRejectedValue(new Error('Se pisa con otra clase tuya de 13:00 a 15:00.'))
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.type(
      within(modal).getByLabelText('Link de la videollamada'),
      'https://meet.example.com/x',
    )
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(await within(modal).findByRole('alert')).toHaveTextContent(
      'Se pisa con otra clase tuya de 13:00 a 15:00.',
    )
  })

  it('editar un horario lo manda con su id', async () => {
    await entrar()
    const modal = await abrirModalDelBloque()

    await userEvent.click(within(modal).getByRole('button', { name: /^Editar el horario/ }))
    await userEvent.click(within(modal).getByRole('button', { name: 'Presencial' }))
    await userEvent.type(within(modal).getByLabelText('Localidad'), 'Palermo, CABA')
    await userEvent.type(within(modal).getByLabelText('Dirección exacta'), 'Aula 3')
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(updateWindow).toHaveBeenCalledTimes(1))
    expect(updateWindow).toHaveBeenCalledWith('w1', {
      date: HOY,
      repeatsWeekly: false,
      start: '13:00',
      end: '15:00',
      modality: 'in_person',
      maxStudents: 1,
      meetingUrl: '',
      locality: 'Palermo, CABA',
      address: 'Aula 3',
    })
  })

  it('una presencial pide localidad y dirección exacta', async () => {
    await entrar()
    await bloque()
    const modal = await abrirFormulario()

    await userEvent.click(within(modal).getByRole('button', { name: 'Presencial' }))
    await userEvent.click(within(modal).getByRole('button', { name: 'Guardar' }))

    expect(within(modal).getByText('Escribí la zona, por ejemplo Palermo, CABA.')).toBeInTheDocument()
    expect(within(modal).getByText('Escribí la dirección exacta.')).toBeInTheDocument()
    expect(createWindow).not.toHaveBeenCalled()
  })

  it('eliminar pide confirmación, y si se repite avisa que es de todas las semanas', async () => {
    fetchMyWindows.mockResolvedValue([ventana({ repeatsWeekly: true })])
    await entrar()
    const modal = await abrirModalDelBloque()

    await userEvent.click(within(modal).getByRole('button', { name: /^Eliminar el horario/ }))
    expect(within(modal).getByText(/Se borra de todas las semanas/)).toBeInTheDocument()
    expect(within(modal).getByText(/Las clases ya reservadas no se cancelan/)).toBeInTheDocument()
    expect(deleteWindow).not.toHaveBeenCalled()

    await userEvent.click(within(modal).getByRole('button', { name: 'Sí, eliminar' }))
    await waitFor(() => expect(deleteWindow).toHaveBeenCalledWith('w1'))
  })

  it('las flechas del modal pasan de día', async () => {
    await entrar()
    const modal = await abrirModalDelBloque()
    expect(within(modal).getByText('Hoy')).toBeInTheDocument()

    await userEvent.click(within(modal).getByRole('button', { name: 'Día siguiente' }))

    expect(within(modal).queryByText('Hoy')).not.toBeInTheDocument()
    // La ventana es de hoy y no se repite: mañana no hay nada. Si mañana cae
    // en la semana siguiente, la de atrás la sigue y se recarga.
    expect(await within(modal).findByText('No ofrecés horarios este día.')).toBeInTheDocument()
  })

  it('un día que ya pasó se ve pero no se toca', async () => {
    await entrar()
    const modal = await abrirModalDelBloque()

    await userEvent.click(within(modal).getByRole('button', { name: 'Día anterior' }))

    expect(await within(modal).findByText('Ya pasó')).toBeInTheDocument()
    expect(within(modal).queryByRole('button', { name: 'Agregar horario' })).not.toBeInTheDocument()
  })

  it('sin tarifas no deja agregar horarios y manda al perfil', async () => {
    await entrar({ ...docente, rates: [] })

    expect(screen.getByRole('button', { name: 'Agregar horario' })).toBeDisabled()
    expect(screen.getByRole('link', { name: 'Cargá tus tarifas en tu perfil' })).toHaveAttribute(
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

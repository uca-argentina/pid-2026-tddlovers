import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ReservationsPage from './ReservationsPage.jsx'
import { apiClass } from '../../testing/fixtures.js'

const { acceptTurn, addFavoriteTeacher, fetchClasses, fetchFavoriteTeachers, markAttendance } =
  vi.hoisted(() => ({
    acceptTurn: vi.fn(),
    addFavoriteTeacher: vi.fn(),
    fetchClasses: vi.fn(),
    fetchFavoriteTeachers: vi.fn(),
    markAttendance: vi.fn(),
  }))

vi.mock('../../api/client.js', () => ({
  acceptLesson: vi.fn(),
  acceptTurn,
  cancelTurn: vi.fn(),
  addFavoriteTeacher,
  cancelLesson: vi.fn(),
  classFileUrl: (id, fileId) => `/api/classes/${id}/material/files/${fileId}`,
  deleteClassFile: vi.fn(),
  fetchClasses,
  fetchClassMaterial: vi.fn().mockResolvedValue({ summary: '', updatedAt: null, files: [] }),
  fetchFavoriteTeachers,
  markAttendance,
  payLesson: vi.fn(),
  saveClassSummary: vi.fn(),
  uploadClassFiles: vi.fn(),
}))

// "Ahora" fijo: domingo 13/9/2099 a las 11:35.
const AHORA = { iso: '2099-09-13', time: '11:35' }
const reserva = (over = {}) => apiClass({ id: 'r1', ...over })

function renderPage(viewRole = 'student') {
  return render(
    <MemoryRouter>
      <ReservationsPage viewRole={viewRole} now={AHORA} />
    </MemoryRouter>,
  )
}

const categoria = (name) => screen.getByRole('button', { name: new RegExp(`^${name}`) })

beforeEach(() => {
  fetchClasses.mockReset()
  acceptTurn.mockReset()
  markAttendance.mockReset()
  fetchFavoriteTeachers.mockReset().mockResolvedValue([])
  addFavoriteTeacher.mockReset().mockResolvedValue(null)
})

describe('ReservationsPage', () => {
  it('muestra las cinco categorías, con la cantidad solo en las que esperan algo', async () => {
    fetchClasses.mockResolvedValue([
      reserva({ id: 'a' }),
      reserva({ id: 'b', startTime: '15:00', endTime: '16:00' }),
      reserva({ id: 'c', status: 'confirmada', date: '2099-09-20' }),
      reserva({ id: 'd', status: 'realizada', date: '2099-09-01' }),
      reserva({ id: 'e', status: 'cancelada', cancelReason: 'cancelada', cancelledBy: 'student' }),
    ])

    renderPage()

    await screen.findByText('Próxima clase')
    expect(categoria('Pendientes')).toHaveAccessibleName('Pendientes: 2 clases')
    expect(categoria('Aceptadas')).toHaveAccessibleName('Aceptadas: 0 clases')
    expect(categoria('Confirmadas')).toHaveAccessibleName('Confirmadas: 1 clase')
    expect(categoria('Finalizadas')).toHaveAccessibleName('Finalizadas')
    expect(categoria('Canceladas')).toHaveAccessibleName('Canceladas')
  })

  it('tocar una categoría abre su lista, con las que vienen de la más cercana a la más lejana', async () => {
    fetchClasses.mockResolvedValue([
      reserva({ id: 'lejos', subjectName: 'Química', date: '2099-10-01' }),
      reserva({ id: 'cerca', subjectName: 'Física', date: '2099-09-20' }),
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /^Pendientes/ }))

    const lista = screen.getByRole('dialog', { name: 'Pendientes' })
    const materias = within(lista)
      .getAllByRole('listitem')
      .map((li) => within(li).getByRole('button', { name: /Física|Química/ }).textContent)
    expect(materias).toEqual(['Física', 'Química'])
  })

  it('las canceladas dicen por qué, de la más nueva a la más vieja', async () => {
    fetchClasses.mockResolvedValue([
      reserva({ id: 'vieja', status: 'cancelada', date: '2099-08-01', subjectName: 'Historia' }),
      reserva({
        id: 'nueva',
        status: 'cancelada',
        date: '2099-09-01',
        cancelReason: 'rechazada',
        cancelledBy: 'teacher',
        subjectName: 'Geografía',
      }),
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /^Canceladas/ }))

    const lista = screen.getByRole('dialog', { name: 'Canceladas' })
    const items = within(lista).getAllByRole('listitem')
    expect(within(items[0]).getByText('Geografía')).toBeInTheDocument()
    expect(within(items[0]).getByText('El docente rechazó la reserva.')).toBeInTheDocument()
  })

  it('arriba están la próxima clase (aunque esté en curso) y la última', async () => {
    fetchClasses.mockResolvedValue([
      reserva({ id: 'ayer', status: 'realizada', date: '2099-09-12', subjectName: 'Biología' }),
      reserva({
        id: 'ahora',
        status: 'confirmada',
        date: '2099-09-13',
        startTime: '11:00',
        endTime: '12:30',
        subjectName: 'Programación',
      }),
      reserva({ id: 'despues', date: '2099-09-20', subjectName: 'Inglés' }),
    ])

    renderPage()

    const proxima = await screen.findByRole('region', { name: 'Próxima clase' })
    expect(within(proxima).getByText('Programación')).toBeInTheDocument()
    expect(within(proxima).getByText('En curso')).toBeInTheDocument()
    const ultima = screen.getByRole('region', { name: 'Última clase' })
    expect(within(ultima).getByText('Biología')).toBeInTheDocument()
  })

  it('sin clases, lo dice en las dos tarjetas', async () => {
    fetchClasses.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('No tenés clases próximas.')).toBeInTheDocument()
    expect(screen.getByText('Todavía no tuviste ninguna clase.')).toBeInTheDocument()
    const pedido = fetchClasses.mock.calls[0][0]
    expect(pedido.status).toBeUndefined()
    expect(pedido.from < pedido.to).toBe(true)
  })

  it('el docente acepta desde la tarjeta y la reserva cambia de categoría', async () => {
    fetchClasses.mockResolvedValue([reserva({ date: '2099-09-20' })])
    acceptTurn.mockResolvedValue([reserva({ date: '2099-09-20', status: 'aceptada' })])

    renderPage('teacher')
    await userEvent.click(await screen.findByRole('button', { name: /^Pendientes/ }))
    const lista = screen.getByRole('dialog', { name: 'Pendientes' })
    // La tarjeta no dice quién: eso va en el detalle.
    expect(within(lista).getByText('Individual', { exact: false })).toBeInTheDocument()
    expect(within(lista).queryByText(/Sofía Ramírez/)).not.toBeInTheDocument()

    await userEvent.click(within(lista).getByRole('button', { name: 'Aceptar' }))

    expect(await within(lista).findByText('No hay clases pendientes.')).toBeInTheDocument()
    expect(categoria('Aceptadas')).toHaveAccessibleName('Aceptadas: 1 clase')
  })

  it('en la tarjeta no se toma lista: eso va en el detalle', async () => {
    const pasada = reserva({ status: 'confirmada', date: '2099-09-12' })
    fetchClasses.mockResolvedValue([pasada])
    markAttendance.mockResolvedValue({ ...pasada, status: 'realizada' })

    renderPage('teacher')
    await userEvent.click(await screen.findByRole('button', { name: /^Confirmadas/ }))
    const lista = screen.getByRole('dialog', { name: 'Confirmadas' })
    expect(within(lista).queryByRole('button', { name: 'Presente' })).not.toBeInTheDocument()

    await userEvent.click(within(lista).getByRole('button', { name: 'Matemática' }))

    const detalle = screen.getByRole('dialog', { name: 'Matemática' })
    await userEvent.click(within(detalle).getByRole('button', { name: 'Tomar asistencia' }))
    const asistencia = screen.getByRole('dialog', { name: 'Tomar asistencia' })
    expect(within(asistencia).getByText('Sofía Ramírez')).toBeInTheDocument()
    await userEvent.click(within(asistencia).getByRole('button', { name: 'Presente' }))
    expect(markAttendance).toHaveBeenCalledWith('r1', true)
  })

  it('tocar la última clase abre su detalle', async () => {
    fetchClasses.mockResolvedValue([reserva({ status: 'realizada', date: '2099-09-12' })])

    renderPage()
    const ultima = await screen.findByRole('region', { name: 'Última clase' })
    await userEvent.click(within(ultima).getByText('Docente: Laura Gómez', { exact: false }))

    expect(screen.getByRole('dialog', { name: 'Matemática' })).toBeInTheDocument()
    expect(await screen.findByText('El docente todavía no cargó material de esta clase.')).toBeInTheDocument()
  })

  it('si no carga, lo dice', async () => {
    fetchClasses.mockRejectedValue(new Error('Se cayó todo'))

    renderPage()

    expect(await screen.findByText('Se cayó todo')).toBeInTheDocument()
  })

  it('el alumno marca como favorito al docente de una reserva', async () => {
    fetchClasses.mockResolvedValue([reserva({ teacherId: 't1', teacherName: 'Laura Gómez' })])

    renderPage()

    await userEvent.click(
      await screen.findByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }),
    )
    expect(addFavoriteTeacher).toHaveBeenCalledWith('t1')
    expect(
      await screen.findByRole('button', { name: 'Sacar de favoritos a Laura Gómez' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('una grupal del docente es una sola tarjeta, y "Aceptar" acepta a todos', async () => {
    const turno = { date: '2099-09-20', startTime: '10:00', endTime: '11:00', maxStudents: 3 }
    const sofia = reserva({ ...turno, id: 'a', studentName: 'Sofía Ramírez' })
    const ana = reserva({ ...turno, id: 'b', studentName: 'Ana Pérez' })
    fetchClasses.mockResolvedValue([sofia, ana])
    acceptTurn.mockResolvedValue([
      { ...sofia, status: 'aceptada' },
      { ...ana, status: 'aceptada' },
    ])

    renderPage('teacher')
    await userEvent.click(await screen.findByRole('button', { name: /^Pendientes/ }))
    const lista = screen.getByRole('dialog', { name: 'Pendientes' })
    expect(within(lista).getAllByRole('listitem')).toHaveLength(1)
    expect(within(lista).getByText(/Grupal · 2 de 3/)).toBeInTheDocument()

    await userEvent.click(within(lista).getByRole('button', { name: 'Aceptar a los 2' }))

    // Un solo pedido por la clase entera: todo o nada.
    expect(acceptTurn).toHaveBeenCalledTimes(1)
    expect(await within(lista).findByText('No hay clases pendientes.')).toBeInTheDocument()
  })

  it('en la lista de una categoría se filtra por nombre, materia y fecha', async () => {
    const mate = { subjectId: 'm', subjectName: 'Matemática' }
    const finalizada = (over) => reserva({ status: 'realizada', ...over })
    fetchClasses.mockResolvedValue([
      finalizada({ ...mate, id: 'a', date: '2099-09-01', teacherName: 'Laura Gómez' }),
      finalizada({
        id: 'b',
        date: '2099-09-05',
        subjectId: 'f',
        subjectName: 'Física',
        teacherName: 'Carla Benítez',
      }),
      finalizada({ ...mate, id: 'c', date: '2099-09-10', teacherName: 'Carla Benítez' }),
    ])

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /^Finalizadas/ }))
    const lista = screen.getByRole('dialog', { name: 'Finalizadas' })
    const tarjetas = () => within(lista).queryAllByRole('listitem')
    expect(tarjetas()).toHaveLength(3)

    const buscar = within(lista).getByRole('searchbox', { name: 'Buscar por docente' })
    await userEvent.type(buscar, 'benitez')
    expect(tarjetas()).toHaveLength(2)

    await userEvent.selectOptions(within(lista).getByRole('combobox'), 'Matemática')
    expect(tarjetas()).toHaveLength(1)
    expect(within(lista).getByText('1 de 3 clases')).toBeInTheDocument()

    fireEvent.change(within(lista).getByLabelText('Hasta'), { target: { value: '2099-09-09' } })
    expect(within(lista).getByText('Ninguna clase coincide con los filtros.')).toBeInTheDocument()

    await userEvent.click(within(lista).getByRole('button', { name: 'Limpiar filtros' }))
    expect(tarjetas()).toHaveLength(3)
  })

  it('el docente busca por nombre de alumno', async () => {
    fetchClasses.mockResolvedValue([reserva({ date: '2099-09-20' })])

    renderPage('teacher')
    await userEvent.click(await screen.findByRole('button', { name: /^Pendientes/ }))

    expect(screen.getByRole('searchbox', { name: 'Buscar por alumno' })).toBeInTheDocument()
  })

  it('el docente no ve corazones', async () => {
    fetchClasses.mockResolvedValue([reserva()])

    renderPage('teacher')

    await screen.findByRole('region', { name: 'Próxima clase' })
    expect(screen.queryByRole('button', { name: /favoritos/ })).not.toBeInTheDocument()
    expect(fetchFavoriteTeachers).not.toHaveBeenCalled()
  })
})

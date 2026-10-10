import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CalendarPage from './CalendarPage.jsx'
import { addMonths, formatMonthTitle, toISODate } from '../../utils/calendar.js'
import { apiClass } from '../../testing/fixtures.js'

// El mock del cliente evita depender de los datos de mentira reales: acá
// definimos exactamente qué clases hay y en qué día.
const { addFavoriteTeacher, fetchClasses, fetchFavoriteTeachers } = vi.hoisted(() => ({
  addFavoriteTeacher: vi.fn(() => Promise.resolve(null)),
  fetchClasses: vi.fn(),
  // Salvo en sus tests, el alumno no tiene favoritos.
  fetchFavoriteTeachers: vi.fn(() => Promise.resolve([])),
}))

vi.mock('../../api/client.js', () => ({ addFavoriteTeacher, fetchClasses, fetchFavoriteTeachers }))

// Las clases traen links (reprogramar, ver solicitudes): hace falta un router.
function render(ui) {
  return rtlRender(<MemoryRouter>{ui}</MemoryRouter>)
}

const today = new Date()

// El calendario es "mis clases": muestra todo lo que no está cancelado.
function classOn(iso, overrides = {}) {
  return apiClass({
    id: `c-${iso}`,
    date: iso,
    startTime: '09:00',
    endTime: '10:00',
    subjectName: 'Álgebra',
    status: 'confirmada',
    ...overrides,
  })
}

describe('CalendarPage', () => {
  beforeEach(() => {
    fetchClasses.mockReset()
    fetchClasses.mockResolvedValue([])
  })

  it('muestra el mes actual', async () => {
    render(<CalendarPage />)
    expect(await screen.findByText(formatMonthTitle(today))).toBeInTheDocument()
  })

  it('pide las clases del rango que abarca la grilla', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(fetchClasses).toHaveBeenCalled())
    const { from, to } = fetchClasses.mock.calls[0][0]
    expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from < to).toBe(true)
  })

  it('lista las clases del día seleccionado (hoy, por defecto)', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { startTime: '16:30', endTime: '17:30', subjectName: 'Programación' }),
    ])

    render(<CalendarPage />)

    // Aparece dos veces: en el casillero del calendario y en el panel de la
    // izquierda con el detalle.
    expect((await screen.findAllByText('Programación')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('16:30').length).toBeGreaterThan(0)
    // El panel muestra cuánto dura, no la hora de fin.
    expect(screen.getByText('1 h')).toBeInTheDocument()
  })

  it('muestra al docente cuando se mira como alumno', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { teacherName: 'Laura Gómez', studentName: 'Sofía Ramírez' }),
    ])

    render(<CalendarPage viewRole="student" />)

    expect(await screen.findByText(/Laura Gómez/)).toBeInTheDocument()
    expect(screen.queryByText(/Sofía Ramírez/)).not.toBeInTheDocument()
  })

  it('el alumno puede marcar como favorito al docente de una clase', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { teacherId: 't1', teacherName: 'Laura Gómez' }),
    ])

    render(<CalendarPage viewRole="student" />)

    await userEvent.click(
      await screen.findByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }),
    )
    expect(addFavoriteTeacher).toHaveBeenCalledWith('t1')
    expect(
      await screen.findByRole('button', { name: 'Sacar de favoritos a Laura Gómez' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('el corazón arranca lleno si el docente ya es favorito', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso, { teacherId: 't1', teacherName: 'Laura Gómez' })])
    fetchFavoriteTeachers.mockResolvedValueOnce([
      { id: 't1', nombre: 'Laura', apellido: 'Gómez', subjects: [] },
    ])

    render(<CalendarPage viewRole="student" />)

    expect(
      await screen.findByRole('button', { name: 'Sacar de favoritos a Laura Gómez' }),
    ).toHaveAttribute('aria-pressed', 'true')
  })

  it('el docente no ve corazones', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso, { studentName: 'Sofía Ramírez' })])

    render(<CalendarPage viewRole="teacher" />)

    await screen.findByText(/Sofía Ramírez/)
    expect(screen.queryByRole('button', { name: /favoritos/ })).not.toBeInTheDocument()
  })

  it('muestra al alumno cuando se mira como docente', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { teacherName: 'Laura Gómez', studentName: 'Sofía Ramírez' }),
    ])

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText(/Sofía Ramírez/)).toBeInTheDocument()
    expect(screen.queryByText(/Laura Gómez/)).not.toBeInTheDocument()
  })

  it('pide todas las clases, no un solo estado', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(fetchClasses).toHaveBeenCalled())
    expect(fetchClasses.mock.calls[0][0].status).toBeUndefined()
  })

  it('no muestra las canceladas', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { status: 'cancelada', subjectName: 'Fantasma' }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByText('0 clases')).toBeInTheDocument()
    expect(screen.queryByText('Fantasma')).not.toBeInTheDocument()
  })

  it('muestra el estado de cada clase, pendientes incluidas', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso, { status: 'pendiente', subjectName: 'Química' })])

    render(<CalendarPage />)

    expect((await screen.findAllByText('Química')).length).toBeGreaterThan(0)
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
  })

  it('al docente le avisa cuántas solicitudes esperan respuesta', async () => {
    fetchClasses.mockImplementation(({ status }) =>
      Promise.resolve(
        status === 'pendiente'
          ? [classOn('2099-01-01', { id: 'p1', status: 'pendiente' }), classOn('2099-01-02', { id: 'p2', status: 'pendiente' })]
          : [],
      ),
    )

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText(/Tenés 2 solicitudes de clase esperando respuesta/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ver solicitudes' })).toHaveAttribute('href', '/reservas')
  })

  it('defensivo: una clase sin alumno no rompe la vista de docente', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso, { studentName: null })])

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText(/Sin reservar/)).toBeInTheDocument()
  })

  it('una grupal se ve una sola vez con todos sus alumnos', async () => {
    const iso = toISODate(today)
    const grupal = { teacherId: 't1', maxStudents: 4, subjectName: 'Física' }
    fetchClasses.mockResolvedValue([
      classOn(iso, { ...grupal, id: 'a', studentName: 'Sofía Ramírez' }),
      classOn(iso, { ...grupal, id: 'b', studentName: 'Tomás Díaz' }),
    ])

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText('Sofía Ramírez, Tomás Díaz')).toBeInTheDocument()
    // La pastilla de cupo dice cuántos van, como en las tarjetas de Reservar.
    expect(screen.getByText('Grupal · 2 de 4')).toBeInTheDocument()
    expect(screen.getByText('1 clase')).toBeInTheDocument()
  })

  it('una clase virtual trae el link para entrar', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { modality: 'virtual', meetingUrl: 'https://meet.example.com/abc' }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByRole('link', { name: 'Entrar a la videollamada' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    )
  })

  it('una clase presencial reservada muestra la dirección exacta y la zona', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, {
        modality: 'in_person',
        meetingUrl: null,
        address: 'Honduras 4800, 2° B',
        locality: 'Palermo',
      }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByText('Honduras 4800, 2° B')).toBeInTheDocument()
    expect(screen.getByText('Palermo')).toBeInTheDocument()
  })

  it('el alumno ve toda la información de la clase que reservó', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, {
        startTime: '10:00',
        endTime: '11:30',
        subjectName: 'Física',
        teacherName: 'Laura Gómez',
        modality: 'hybrid',
        meetingUrl: 'https://meet.example.com/abc',
        address: 'Honduras 4800, 2° B',
        locality: 'Palermo, CABA',
        maxStudents: 4,
        enrolled: 3,
        // 1 h 30 min a $ 12.000,50/h.
        priceCents: 1800075,
      }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByText('10:00 – 11:30')).toBeInTheDocument()
    expect(screen.getByText('1 h 30 min')).toBeInTheDocument()
    expect(screen.getByText('Híbrida')).toBeInTheDocument()
    expect(screen.getByText('Laura Gómez')).toBeInTheDocument()
    expect(screen.getByText('Grupal · 3 de 4')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Entrar a la videollamada' })).toHaveAttribute(
      'href',
      'https://meet.example.com/abc',
    )
    expect(screen.getByText('Honduras 4800, 2° B')).toBeInTheDocument()
    expect(screen.getByText('Palermo, CABA')).toBeInTheDocument()
    expect(screen.getByText(/18\.000,75/)).toBeInTheDocument()
  })

  it('una individual dice individual, y una sin cargo lo dice', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { modality: 'virtual', meetingUrl: 'https://x.com', maxStudents: 1, enrolled: 1, priceCents: 0 }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByText('Individual')).toBeInTheDocument()
    expect(screen.getByText('Sin cargo')).toBeInTheDocument()
  })

  it('ordena las clases del día por hora', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { id: 'tarde', startTime: '18:00', endTime: '19:00', subjectName: 'Química' }),
      classOn(iso, { id: 'temprano', startTime: '08:30', endTime: '09:30', subjectName: 'Física' }),
      classOn(iso, { id: 'medio', startTime: '14:00', endTime: '15:00', subjectName: 'Inglés' }),
    ])

    render(<CalendarPage />)

    // Cada clase es un <li> con su lista de datos (cupo, link) adentro: se
    // toman solo las materias, una por clase.
    await waitFor(() => expect(document.querySelectorAll('.day-agenda-subject')).toHaveLength(3))
    const orden = [...document.querySelectorAll('.day-agenda-subject')].map((el) => el.textContent)
    expect(orden).toEqual(['Física', 'Inglés', 'Química'])
  })

  it('cuenta las clases del día en la celda', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso), classOn(iso, { id: 'otra', startTime: '14:00' })])

    render(<CalendarPage />)

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /2 clases/ })).toBeInTheDocument(),
    )
  })

  it('cambia de mes con las flechas', async () => {
    render(<CalendarPage />)
    await screen.findByText(formatMonthTitle(today))

    await userEvent.click(screen.getByLabelText('Mes siguiente'))
    expect(await screen.findByText(formatMonthTitle(addMonths(today, 1)))).toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Mes anterior'))
    expect(await screen.findByText(formatMonthTitle(today))).toBeInTheDocument()
  })

  it('muestra un cartel de error si falla la carga', async () => {
    fetchClasses.mockRejectedValue(new Error('Se cayó todo.'))
    render(<CalendarPage />)
    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })
})

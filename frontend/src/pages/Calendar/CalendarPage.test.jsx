import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CalendarPage from './CalendarPage.jsx'
import { addMonths, formatMonthTitle, toISODate } from '../../utils/calendar.js'

// El mock del cliente evita depender de los datos de mentira reales: acá
// definimos exactamente qué clases hay y en qué día.
const { fetchClasses } = vi.hoisted(() => ({ fetchClasses: vi.fn() }))

vi.mock('../../api/client.js', () => ({ fetchClasses }))

const today = new Date()

// El calendario es "mis clases": solo muestra reservadas, así que las
// fixtures tienen que serlo o las filtra antes de llegar a la pantalla.
function classOn(iso, overrides = {}) {
  return {
    id: `c-${iso}`,
    date: iso,
    startTime: '09:00',
    endTime: '10:00',
    subjectName: 'Álgebra',
    teacherName: 'Laura Gómez',
    studentName: 'Sofía Ramírez',
    status: 'reservada',
    ...overrides,
  }
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

  it('muestra al alumno cuando se mira como docente', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { teacherName: 'Laura Gómez', studentName: 'Sofía Ramírez' }),
    ])

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText(/Sofía Ramírez/)).toBeInTheDocument()
    expect(screen.queryByText(/Laura Gómez/)).not.toBeInTheDocument()
  })

  it('pide solo las clases reservadas', async () => {
    render(<CalendarPage />)
    await waitFor(() => expect(fetchClasses).toHaveBeenCalled())
    expect(fetchClasses.mock.calls[0][0].status).toBe('reservada')
  })

  it('no muestra turnos libres aunque vengan en la respuesta', async () => {
    // El backend todavía no existe; si algún día ignora el ?status, un turno
    // libre acá se leería como una clase que nadie reservó.
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { status: 'disponible', subjectName: 'Fantasma' }),
    ])

    render(<CalendarPage />)

    expect(await screen.findByText('0 clases')).toBeInTheDocument()
    expect(screen.queryByText('Fantasma')).not.toBeInTheDocument()
  })

  it('defensivo: una clase sin alumno no rompe la vista de docente', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([classOn(iso, { studentName: null })])

    render(<CalendarPage viewRole="teacher" />)

    expect(await screen.findByText(/Sin reservar/)).toBeInTheDocument()
  })

  it('ordena las clases del día por hora', async () => {
    const iso = toISODate(today)
    fetchClasses.mockResolvedValue([
      classOn(iso, { id: 'tarde', startTime: '18:00', endTime: '19:00', subjectName: 'Química' }),
      classOn(iso, { id: 'temprano', startTime: '08:30', endTime: '09:30', subjectName: 'Física' }),
      classOn(iso, { id: 'medio', startTime: '14:00', endTime: '15:00', subjectName: 'Inglés' }),
    ])

    render(<CalendarPage />)

    const items = await screen.findAllByRole('listitem')
    const orden = items.map((item) => item.querySelector('.day-agenda-subject').textContent)
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

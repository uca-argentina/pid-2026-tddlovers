import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ReservationsPage from './ReservationsPage.jsx'

const { acceptLesson, fetchClasses } = vi.hoisted(() => ({
  acceptLesson: vi.fn(),
  fetchClasses: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({
  acceptLesson,
  cancelLesson: vi.fn(),
  fetchClasses,
  markAttendance: vi.fn(),
  payLesson: vi.fn(),
}))

// Siempre en el futuro, para que "ya empezó" no dependa del reloj.
const reserva = (over = {}) => ({
  id: 'r1',
  date: '2099-09-14',
  startTime: '13:00',
  endTime: '14:00',
  subjectName: 'Matemática',
  teacherName: 'Laura Gómez',
  studentName: 'Sofía Ramírez',
  status: 'pendiente',
  paidAt: null,
  modality: 'virtual',
  priceCents: 500000,
  ...over,
})

function renderPage(viewRole = 'student') {
  return render(
    <MemoryRouter>
      <ReservationsPage viewRole={viewRole} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  fetchClasses.mockReset()
  acceptLesson.mockReset()
})

describe('ReservationsPage', () => {
  it('agrupa las reservas por estado, canceladas incluidas', async () => {
    fetchClasses.mockResolvedValue([
      reserva({ id: 'a', subjectName: 'Física' }),
      reserva({ id: 'b', status: 'confirmada', paidAt: 'x', subjectName: 'Química' }),
      reserva({ id: 'c', status: 'cancelada', cancelReason: 'rechazada', cancelledBy: 'teacher', subjectName: 'Historia' }),
    ])

    renderPage()

    const pendientes = await screen.findByRole('region', { name: /Pendientes/ })
    expect(within(pendientes).getByText('Física')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: /Confirmadas/ })).getByText('Química')).toBeInTheDocument()
    const canceladas = screen.getByRole('region', { name: /Canceladas/ })
    expect(within(canceladas).getByText('Historia')).toBeInTheDocument()
    expect(within(canceladas).getByText('El docente rechazó la reserva.')).toBeInTheDocument()
    // Secciones vacías no se muestran.
    expect(screen.queryByRole('region', { name: /Aceptadas/ })).not.toBeInTheDocument()
  })

  it('pide un rango amplio y todos los estados', async () => {
    fetchClasses.mockResolvedValue([])

    renderPage()

    expect(await screen.findByText('Todavía no reservaste ninguna clase.')).toBeInTheDocument()
    const pedido = fetchClasses.mock.calls[0][0]
    expect(pedido.status).toBeUndefined()
    expect(pedido.from < pedido.to).toBe(true)
  })

  it('el docente acepta y la reserva pasa de sección', async () => {
    fetchClasses.mockResolvedValue([reserva()])
    acceptLesson.mockResolvedValue(reserva({ status: 'aceptada' }))

    renderPage('teacher')

    const pendientes = await screen.findByRole('region', { name: /Pendientes/ })
    expect(within(pendientes).getByText('Alumno: Sofía Ramírez', { exact: false })).toBeInTheDocument()
    await userEvent.click(within(pendientes).getByRole('button', { name: 'Aceptar' }))

    const aceptadas = await screen.findByRole('region', { name: /Aceptadas/ })
    expect(within(aceptadas).getByText('Matemática')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: /Pendientes/ })).not.toBeInTheDocument()
  })

  it('si no carga, lo dice', async () => {
    fetchClasses.mockRejectedValue(new Error('Se cayó todo'))

    renderPage()

    expect(await screen.findByText('Se cayó todo')).toBeInTheDocument()
  })
})

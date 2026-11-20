import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StudentsDialog from './StudentsDialog.jsx'
import { apiBooking } from '../testing/fixtures.js'

const { acceptBooking, cancelBooking } = vi.hoisted(() => ({
  acceptBooking: vi.fn(),
  cancelBooking: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ acceptBooking, cancelBooking }))

const ANTES = { iso: '2099-09-10', time: '10:00' }
const clase = { date: '2099-09-14', startTime: '13:00', maxStudents: 3 }
const sofia = apiBooking({
  ...clase,
  id: 'r1',
  status: 'confirmada',
  paidAt: '2099-09-01T12:00:00.000Z',
  studentName: 'Sofía Ramírez',
})
const ana = apiBooking({ ...clase, id: 'r2', status: 'pendiente', studentName: 'Ana Pérez' })

beforeEach(() => {
  acceptBooking.mockReset()
  cancelBooking.mockReset()
})

describe('StudentsDialog', () => {
  it('muestra el estado y si pagó cada alumno', () => {
    render(<StudentsDialog rows={[ana, sofia]} now={ANTES} onClose={() => {}} />)

    expect(screen.getByText('2 anotados · 1 pagó')).toBeInTheDocument()
    const [deAna, deSofia] = screen.getAllByRole('listitem')
    expect(within(deAna).getByText('Pendiente')).toBeInTheDocument()
    expect(within(deAna).getByText('Sin pagar')).toBeInTheDocument()
    expect(within(deSofia).getByText('Pagó')).toBeInTheDocument()
  })

  it('rechazar a uno pide confirmación y solo toca su reserva', async () => {
    cancelBooking.mockResolvedValue({ ...ana, status: 'cancelada', cancelReason: 'rechazada' })
    const onChange = vi.fn()
    render(<StudentsDialog rows={[ana, sofia]} now={ANTES} onClose={() => {}} onChange={onChange} />)

    const [deAna] = screen.getAllByRole('listitem')
    await userEvent.click(within(deAna).getByRole('button', { name: 'Rechazar' }))
    expect(within(deAna).getByText('¿Rechazar a Ana Pérez?')).toBeInTheDocument()
    await userEvent.click(within(deAna).getByRole('button', { name: 'Sí, rechazar' }))

    expect(cancelBooking).toHaveBeenCalledWith('r2')
    expect(onChange).toHaveBeenCalledWith({ ...ana, status: 'cancelada', cancelReason: 'rechazada' })
  })

  it('a uno ya confirmado se lo puede sacar de la clase', () => {
    render(<StudentsDialog rows={[sofia]} now={ANTES} onClose={() => {}} />)

    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Aceptar' })).not.toBeInTheDocument()
  })
})

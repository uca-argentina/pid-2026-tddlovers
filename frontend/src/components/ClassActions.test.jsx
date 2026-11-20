import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClassActions from './ClassActions.jsx'
import { apiBooking } from '../testing/fixtures.js'

const { acceptClass, cancelClass } = vi.hoisted(() => ({
  acceptClass: vi.fn(),
  cancelClass: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ acceptClass, cancelClass }))

const ANTES = { iso: '2099-09-10', time: '10:00' }
const clase = { date: '2099-09-14', startTime: '13:00', maxStudents: 3 }
const sofia = apiBooking({ ...clase, id: 'r1', status: 'confirmada', studentName: 'Sofía' })
const ana = apiBooking({ ...clase, id: 'r2', status: 'pendiente', studentName: 'Ana' })

beforeEach(() => {
  acceptClass.mockReset()
  cancelClass.mockReset()
})

describe('ClassActions', () => {
  it('resume los estados de la clase con cuántos alumnos hay en cada uno', () => {
    render(<ClassActions rows={[sofia, ana]} now={ANTES} />)

    expect(screen.getByText('Pendiente · 1')).toBeInTheDocument()
    expect(screen.getByText('Confirmada · 1')).toBeInTheDocument()
  })

  it('cancelar la clase la cancela para todos en un solo pedido, después de confirmar', async () => {
    cancelClass.mockResolvedValue([
      { ...sofia, status: 'cancelada' },
      { ...ana, status: 'cancelada' },
    ])
    const onChange = vi.fn()
    render(<ClassActions rows={[sofia, ana]} now={ANTES} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar clase' }))
    const dialogo = screen.getByRole('dialog', { name: '¿Cancelar la clase?' })
    expect(dialogo).toHaveTextContent('para los 2 alumnos')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, cancelar' }))

    expect(cancelClass).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ...sofia, status: 'cancelada' })
    expect(onChange).toHaveBeenCalledWith({ ...ana, status: 'cancelada' })
  })

  it('una individual pendiente se acepta o se rechaza', () => {
    render(<ClassActions rows={[{ ...ana, maxStudents: 1 }]} now={ANTES} />)

    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument()
  })

  it('una cancelada para todos dice por qué', () => {
    const cancelada = { ...sofia, status: 'cancelada', cancelReason: 'vacaciones' }
    render(<ClassActions rows={[cancelada]} now={ANTES} />)

    expect(screen.getByText('Cancelada')).toBeInTheDocument()
    expect(screen.getByText('Se canceló por tu licencia.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('si falla no cambia nada y lo dice', async () => {
    acceptClass.mockRejectedValue(new Error('La clase cambió mientras tanto. Recargá la página.'))
    const pendientes = [ana, { ...ana, id: 'r3', studentName: 'Beto' }]
    const onChange = vi.fn()
    render(<ClassActions rows={pendientes} now={ANTES} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Aceptar a los 2' }))

    expect(await screen.findByText('La clase cambió mientras tanto. Recargá la página.')).toBeInTheDocument()
    expect(acceptClass).toHaveBeenCalledWith(ana.classId)
    expect(onChange).not.toHaveBeenCalled()
  })
})

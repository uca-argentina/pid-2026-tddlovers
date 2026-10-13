import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TurnActions from './TurnActions.jsx'
import { apiClass } from '../testing/fixtures.js'

const { acceptTurn, cancelTurn } = vi.hoisted(() => ({
  acceptTurn: vi.fn(),
  cancelTurn: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ acceptTurn, cancelTurn }))

const ANTES = { iso: '2099-09-10', time: '10:00' }
const turno = { date: '2099-09-14', startTime: '13:00', maxStudents: 3 }
const sofia = apiClass({ ...turno, id: 'r1', status: 'confirmada', studentName: 'Sofía' })
const ana = apiClass({ ...turno, id: 'r2', status: 'pendiente', studentName: 'Ana' })

beforeEach(() => {
  acceptTurn.mockReset()
  cancelTurn.mockReset()
})

describe('TurnActions', () => {
  it('resume los estados de la clase con cuántos alumnos hay en cada uno', () => {
    render(<TurnActions rows={[sofia, ana]} now={ANTES} />)

    expect(screen.getByText('Pendiente · 1')).toBeInTheDocument()
    expect(screen.getByText('Confirmada · 1')).toBeInTheDocument()
  })

  it('cancelar la clase la cancela para todos en un solo pedido, después de confirmar', async () => {
    cancelTurn.mockResolvedValue([
      { ...sofia, status: 'cancelada' },
      { ...ana, status: 'cancelada' },
    ])
    const onChange = vi.fn()
    render(<TurnActions rows={[sofia, ana]} now={ANTES} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar clase' }))
    const dialogo = screen.getByRole('dialog', { name: '¿Cancelar la clase?' })
    expect(dialogo).toHaveTextContent('para los 2 alumnos')
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, cancelar' }))

    expect(cancelTurn).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith({ ...sofia, status: 'cancelada' })
    expect(onChange).toHaveBeenCalledWith({ ...ana, status: 'cancelada' })
  })

  it('una individual pendiente se acepta o se rechaza', () => {
    render(<TurnActions rows={[{ ...ana, maxStudents: 1 }]} now={ANTES} />)

    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Rechazar' })).toBeInTheDocument()
  })

  it('una cancelada para todos dice por qué', () => {
    const cancelada = { ...sofia, status: 'cancelada', cancelReason: 'vacaciones' }
    render(<TurnActions rows={[cancelada]} now={ANTES} />)

    expect(screen.getByText('Cancelada')).toBeInTheDocument()
    expect(screen.getByText('Se canceló por tu licencia.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('si falla no cambia nada y lo dice', async () => {
    acceptTurn.mockRejectedValue(new Error('La clase cambió mientras tanto. Recargá la página.'))
    const pendientes = [ana, { ...ana, id: 'r3', studentName: 'Beto' }]
    const onChange = vi.fn()
    render(<TurnActions rows={pendientes} now={ANTES} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Aceptar a los 2' }))

    expect(await screen.findByText('La clase cambió mientras tanto. Recargá la página.')).toBeInTheDocument()
    expect(acceptTurn).toHaveBeenCalledWith('r2')
    expect(onChange).not.toHaveBeenCalled()
  })
})

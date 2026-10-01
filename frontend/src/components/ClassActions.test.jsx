import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ClassActions from './ClassActions.jsx'
import { apiClass } from '../testing/fixtures.js'

const { acceptLesson, cancelLesson, markAttendance, payLesson } = vi.hoisted(() => ({
  acceptLesson: vi.fn(),
  cancelLesson: vi.fn(),
  markAttendance: vi.fn(),
  payLesson: vi.fn(),
}))

vi.mock('../api/client.js', () => ({ acceptLesson, cancelLesson, markAttendance, payLesson }))

// La clase es el 14/9/2099 a las 13:00; "ahora" se elige en cada test.
const LEJOS = { iso: '2099-09-10', time: '10:00' }
const CASI = { iso: '2099-09-13', time: '20:00' }
const EMPEZADA = { iso: '2099-09-14', time: '13:30' }

const clase = (over = {}) => apiClass(over)

function renderActions(props) {
  const onChange = vi.fn()
  render(
    <MemoryRouter>
      <ClassActions now={LEJOS} onChange={onChange} {...props} />
    </MemoryRouter>,
  )
  return { onChange }
}

beforeEach(() => {
  for (const fn of [acceptLesson, cancelLesson, markAttendance, payLesson]) fn.mockReset()
})

describe('ClassActions', () => {
  it('muestra el estado', () => {
    renderActions({ cls: clase({ status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' }) })

    expect(screen.getByText('Confirmada')).toBeInTheDocument()
  })

  it('el docente acepta una pendiente', async () => {
    const actualizada = clase({ status: 'aceptada' })
    acceptLesson.mockResolvedValue(actualizada)
    const { onChange } = renderActions({ cls: clase(), viewRole: 'teacher' })

    await userEvent.click(screen.getByRole('button', { name: 'Aceptar' }))

    expect(acceptLesson).toHaveBeenCalledWith('c1')
    expect(onChange).toHaveBeenCalledWith(actualizada)
  })

  it('rechazar pide confirmación antes de mandar nada', async () => {
    cancelLesson.mockResolvedValue(clase({ status: 'cancelada' }))
    renderActions({ cls: clase(), viewRole: 'teacher' })

    await userEvent.click(screen.getByRole('button', { name: 'Rechazar' }))
    expect(cancelLesson).not.toHaveBeenCalled()

    const dialogo = screen.getByRole('dialog', { name: '¿Rechazar la reserva?' })
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Sí, rechazar' }))

    expect(cancelLesson).toHaveBeenCalledWith('c1')
  })

  it('el alumno paga una aceptada', async () => {
    payLesson.mockResolvedValue(clase({ status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' }))
    renderActions({ cls: clase({ status: 'aceptada' }) })

    await userEvent.click(screen.getByRole('button', { name: 'Pagar' }))

    expect(payLesson).toHaveBeenCalledWith('c1')
  })

  it('a menos de 24 h el alumno ya no puede cancelar ni reprogramar, y se le dice', () => {
    renderActions({ cls: clase({ status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' }), now: CASI })

    expect(screen.queryByRole('button', { name: 'Cancelar clase' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Reprogramar' })).not.toBeInTheDocument()
    expect(screen.getByText(/menos de 24 h/)).toBeInTheDocument()
  })

  it('con tiempo, reprogramar lleva a elegir otro horario', () => {
    renderActions({ cls: clase({ status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' }) })

    expect(screen.getByRole('link', { name: 'Reprogramar' })).toHaveAttribute(
      'href',
      '/disponibilidad?reprogramar=c1',
    )
  })

  it('el docente toma lista cuando empezó la clase', async () => {
    markAttendance.mockResolvedValue(clase({ status: 'no_presentada' }))
    renderActions({ cls: clase({ status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' }), viewRole: 'teacher', now: EMPEZADA })

    await userEvent.click(screen.getByRole('button', { name: 'Ausente' }))

    expect(markAttendance).toHaveBeenCalledWith('c1', false)
  })

  it('una clase dada sin pagar lo avisa y se puede pagar', () => {
    renderActions({ cls: clase({ status: 'realizada' }), now: EMPEZADA })

    expect(screen.getByText('Pago pendiente')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeInTheDocument()
  })

  it('explica por qué está cancelada', () => {
    renderActions({
      cls: clase({ status: 'cancelada', cancelReason: 'rechazada', cancelledBy: 'teacher' }),
    })

    expect(screen.getByText('El docente rechazó la reserva.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('si el backend no deja, muestra su mensaje', async () => {
    cancelLesson.mockRejectedValue(new Error('Solo podés cancelar o reprogramar hasta 24 h antes de la clase.'))
    renderActions({ cls: clase({ status: 'aceptada' }) })

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar clase' }))
    await userEvent.click(screen.getByRole('button', { name: 'Sí, cancelar' }))

    expect(await screen.findByText(/hasta 24 h antes/)).toBeInTheDocument()
  })
})

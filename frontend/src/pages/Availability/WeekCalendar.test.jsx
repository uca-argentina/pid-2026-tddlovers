import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeekCalendar from './WeekCalendar.jsx'

// La semana del lunes 12 al domingo 18 de octubre de 2026; "hoy" es el
// miércoles 14. Fechas fijas: no depende del reloj.
const LUNES = new Date(2026, 9, 12)
const HOY = '2026-10-14'

const ventana = (over = {}) => ({
  id: 'w1',
  teacherId: 1,
  date: HOY,
  repeatsWeekly: false,
  start: '13:00',
  end: '15:00',
  modality: 'in_person',
  maxStudents: 4,
  meetingUrl: '',
  locality: 'Palermo, CABA',
  address: 'Honduras 4800',
  ...over,
})

function renderMobile(props = {}) {
  const handlers = {
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    onOpenDay: vi.fn(),
    onOpenWindow: vi.fn(),
  }
  render(
    <WeekCalendar
      mobile
      weekStart={LUNES}
      today={HOY}
      showingThisWeek
      windows={[ventana()]}
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('WeekCalendar en el teléfono', () => {
  it('arranca en hoy y muestra sus horarios como tarjetas', () => {
    renderMobile()

    expect(screen.getByRole('heading', { name: 'Miércoles, 14 de octubre' })).toBeInTheDocument()
    expect(screen.getByText('13:00 – 15:00')).toBeInTheDocument()
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    expect(screen.getByText(/Presencial · Palermo, CABA/)).toBeInTheDocument()
  })

  it('tocar un horario lo abre, y el botón de abajo abre el día', async () => {
    const { onOpenWindow, onOpenDay } = renderMobile()

    await userEvent.click(screen.getByRole('button', { name: /13:00 a 15:00/ }))
    expect(onOpenWindow).toHaveBeenCalledWith(HOY, 'w1')

    await userEvent.click(screen.getByRole('button', { name: /Ver o agregar horarios/ }))
    expect(onOpenDay).toHaveBeenCalledWith(HOY)
  })

  it('elegir otro día de la tira muestra los de ese día', async () => {
    renderMobile()

    await userEvent.click(screen.getByRole('button', { name: /Jueves, 15 de octubre/ }))

    expect(screen.getByRole('heading', { name: 'Jueves, 15 de octubre' })).toBeInTheDocument()
    expect(screen.getByText('No tenés horarios este día.')).toBeInTheDocument()
  })

  it('las flechas pasan de semana', async () => {
    const { onNext } = renderMobile()
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    expect(onNext).toHaveBeenCalled()
  })
})

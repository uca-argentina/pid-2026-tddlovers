import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AttendanceDialog from './AttendanceDialog.jsx'
import { apiClass } from '../testing/fixtures.js'

const { markAttendance } = vi.hoisted(() => ({ markAttendance: vi.fn() }))

vi.mock('../api/client.js', () => ({ markAttendance }))

const sofia = apiClass({ id: 'r1', status: 'confirmada', studentName: 'Sofía Ramírez' })
const ana = apiClass({ id: 'r2', status: 'realizada', studentName: 'Ana Pérez' })
const tomas = apiClass({ id: 'r3', status: 'aceptada', studentName: 'Tomás Díaz' })

beforeEach(() => {
  markAttendance.mockReset().mockImplementation((id, attended) =>
    Promise.resolve({ id, status: attended ? 'realizada' : 'no_presentada' }),
  )
})

describe('AttendanceDialog', () => {
  it('muestra la marca de cada alumno y cuántos faltan', () => {
    render(<AttendanceDialog rows={[sofia, ana, tomas]} onClose={() => {}} />)

    expect(screen.getByText('1 presente · 0 ausentes · 2 sin marcar')).toBeInTheDocument()
    const deAna = screen.getByRole('group', { name: 'Asistencia de Ana Pérez' })
    expect(within(deAna).getByRole('button', { name: 'Presente' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('marcar ausente guarda al toque', async () => {
    const onChange = vi.fn()
    render(<AttendanceDialog rows={[sofia]} onClose={() => {}} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: 'Ausente' }))

    expect(markAttendance).toHaveBeenCalledWith('r1', false)
    expect(onChange).toHaveBeenCalledWith({ id: 'r1', status: 'no_presentada' })
  })

  it('"Todos presentes" marca solo a los que no tenían marca', async () => {
    render(<AttendanceDialog rows={[sofia, ana, tomas]} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Todos presentes' }))

    expect(markAttendance.mock.calls).toEqual([
      ['r1', true],
      ['r3', true],
    ])
  })

  it('si falla, lo dice', async () => {
    markAttendance.mockRejectedValue(new Error('La clase cambió mientras tanto.'))
    render(<AttendanceDialog rows={[sofia]} onClose={() => {}} />)

    await userEvent.click(screen.getByRole('button', { name: 'Presente' }))

    expect(await screen.findByText('La clase cambió mientras tanto.')).toBeInTheDocument()
  })
})

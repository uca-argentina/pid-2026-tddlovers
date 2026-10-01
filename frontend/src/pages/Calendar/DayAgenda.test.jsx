import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DayAgenda from './DayAgenda.jsx'
import { apiClass } from '../../testing/fixtures.js'

vi.mock('../../api/client.js', () => ({
  acceptLesson: vi.fn(),
  cancelLesson: vi.fn(),
  markAttendance: vi.fn(),
  payLesson: vi.fn(),
}))

// En el futuro, para que todavía se pueda aceptar.
const fila = (over = {}) =>
  apiClass({ id: 'a', subjectName: 'Física', teacherName: 'Carla Benítez', maxStudents: 4, ...over })

function renderAgenda(items, viewRole = 'teacher') {
  return render(
    <MemoryRouter>
      <DayAgenda date={new Date(2099, 8, 14)} classes={items} viewRole={viewRole} />
    </MemoryRouter>,
  )
}

describe('DayAgenda', () => {
  it('en una grupal el docente ve a cada alumno con su propia reserva', () => {
    const sofia = fila()
    const tomas = fila({ id: 'b', studentName: 'Tomás Díaz', status: 'confirmada', paidAt: '2099-09-01T12:00:00.000Z' })
    const grupal = { ...sofia, students: ['Sofía Ramírez', 'Tomás Díaz'], rows: [sofia, tomas] }

    renderAgenda([grupal])

    // Solo Sofía espera respuesta: un solo "Aceptar".
    expect(screen.getAllByRole('button', { name: 'Aceptar' })).toHaveLength(1)
    expect(screen.getByText('Pendiente')).toBeInTheDocument()
    expect(screen.getByText('Confirmada')).toBeInTheDocument()
    expect(screen.getByText('Tomás Díaz')).toBeInTheDocument()
  })

  it('una individual muestra su estado sin nombre repetido', () => {
    const clase = fila({ maxStudents: 1, status: 'aceptada' })

    renderAgenda([{ ...clase, students: ['Sofía Ramírez'], rows: [clase] }], 'student')

    expect(screen.getByText('Aceptada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeInTheDocument()
  })
})

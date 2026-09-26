import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DayAgenda from './DayAgenda.jsx'

vi.mock('../../api/client.js', () => ({
  acceptLesson: vi.fn(),
  cancelLesson: vi.fn(),
  markAttendance: vi.fn(),
  payLesson: vi.fn(),
}))

// En el futuro, para que todavía se pueda aceptar.
const fila = (over = {}) => ({
  id: 'a',
  date: '2099-09-14',
  startTime: '13:00',
  endTime: '14:00',
  subjectName: 'Física',
  teacherName: 'Carla Benítez',
  studentName: 'Sofía Ramírez',
  maxStudents: 4,
  status: 'pendiente',
  paidAt: null,
  ...over,
})

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
    const tomas = fila({ id: 'b', studentName: 'Tomás Díaz', status: 'confirmada', paidAt: 'x' })
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
    expect(screen.getByRole('button', { name: 'Confirmar (pagar)' })).toBeInTheDocument()
  })
})

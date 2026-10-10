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

// Las clases de un solo día, el que está elegido.
function renderAgenda(items, viewRole = 'teacher') {
  return render(
    <MemoryRouter>
      <DayAgenda
        classesByDate={{ '2099-09-14': items }}
        selectedIso="2099-09-14"
        viewRole={viewRole}
      />
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

  it('lista las clases de todos los días, en orden, y no solo las del elegido', () => {
    const lunes = fila({ id: 'l', subjectName: 'Química', maxStudents: 1 })
    const jueves = fila({ id: 'j', subjectName: 'Historia', maxStudents: 1 })
    render(
      <MemoryRouter>
        <DayAgenda
          classesByDate={{ '2099-09-17': [jueves], '2099-09-14': [lunes] }}
          selectedIso="2099-09-17"
          viewRole="student"
        />
      </MemoryRouter>,
    )

    const dias = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(dias).toEqual(['Lunes, 14 de septiembre', 'Jueves, 17 de septiembre'])
    expect(screen.getByText('Química')).toBeInTheDocument()
    expect(screen.getByText('Historia')).toBeInTheDocument()
    expect(screen.getByText('2 clases')).toBeInTheDocument()
  })

  it('el día elegido aparece en su lugar aunque no tenga clases', () => {
    const lunes = fila({ id: 'l', subjectName: 'Química', maxStudents: 1 })
    const jueves = fila({ id: 'j', subjectName: 'Historia', maxStudents: 1 })
    render(
      <MemoryRouter>
        <DayAgenda
          classesByDate={{ '2099-09-14': [lunes], '2099-09-17': [jueves] }}
          selectedIso="2099-09-15"
          viewRole="student"
        />
      </MemoryRouter>,
    )

    const dias = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(dias).toEqual([
      'Lunes, 14 de septiembre',
      'Martes, 15 de septiembre',
      'Jueves, 17 de septiembre',
    ])
    expect(screen.getByText('No hay clases este día.')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import DayAgenda from './DayAgenda.jsx'
import { apiClass } from '../../testing/fixtures.js'
import { orderTurnRows, turnKey } from '../../utils/reservations.js'

vi.mock('../../api/client.js', () => ({
  acceptLesson: vi.fn(),
  cancelLesson: vi.fn(),
  markAttendance: vi.fn(),
  payLesson: vi.fn(),
}))

// En el futuro, para que todavía se pueda aceptar.
const fila = (over = {}) =>
  apiClass({ id: 'a', subjectName: 'Física', teacherName: 'Carla Benítez', maxStudents: 4, ...over })

// Un turno como lo arma CalendarPage: la reserva que lo representa, con su
// clave y todas las del turno.
function turno(...reservas) {
  const rows = orderTurnRows(reservas)
  return { ...rows[0], turnKey: turnKey(rows[0]), rows }
}

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
  it('en una grupal el docente ve una sola clase, sin nombres, con botones para toda la clase', () => {
    const sofia = fila()
    const tomas = fila({
      id: 'b',
      studentName: 'Tomás Díaz',
      status: 'confirmada',
      paidAt: '2099-09-01T12:00:00.000Z',
    })
    renderAgenda([turno(sofia, tomas)])

    expect(screen.getByText('Pendiente · 1')).toBeInTheDocument()
    expect(screen.getByText('Confirmada · 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Aceptar' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancelar clase' })).toBeInTheDocument()
    expect(screen.queryByText(/Tomás Díaz/)).not.toBeInTheDocument()
  })

  it('una individual muestra su estado sin nombre repetido', () => {
    const clase = fila({ maxStudents: 1, status: 'aceptada' })

    renderAgenda([turno(clase)], 'student')

    expect(screen.getByText('Aceptada')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pagar' })).toBeInTheDocument()
  })

  it('lista las clases de todos los días, en orden, y no solo las del elegido', () => {
    const lunes = fila({ id: 'l', subjectName: 'Química', maxStudents: 1 })
    const jueves = fila({ id: 'j', subjectName: 'Historia', maxStudents: 1 })
    render(
      <MemoryRouter>
        <DayAgenda
          classesByDate={{ '2099-09-17': [turno(jueves)], '2099-09-14': [turno(lunes)] }}
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
          classesByDate={{ '2099-09-14': [turno(lunes)], '2099-09-17': [turno(jueves)] }}
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

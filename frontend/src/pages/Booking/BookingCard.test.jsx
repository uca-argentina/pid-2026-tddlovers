import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingCard from './BookingCard.jsx'

// Una fila ya pasada por annotateClashes, que es lo que recibe la tarjeta.
function card(overrides = {}) {
  return {
    id: 'w1|2026-09-14',
    windowId: 'w1',
    date: '2026-09-14',
    dayKey: 'lunes',
    teacherId: 2,
    teacherName: 'Laura Gómez',
    start: '13:00',
    end: '15:30',
    modality: 'virtual',
    maxStudents: 1,
    locality: null,
    subjects: [
      { id: 2, name: 'Física', hourlyRateCents: 600000 },
      { id: 1, name: 'Matemática', hourlyRateCents: 500000 },
    ],
    free: [{ start: '13:00', end: '15:30' }],
    groups: [],
    starts: [
      { start: '13:00', maxMinutes: 150, blocked: false },
      { start: '13:30', maxMinutes: 120, blocked: false },
    ],
    clashes: [],
    joined: [],
    bookable: true,
    ...overrides,
  }
}

function renderCard(overrides, onReservar = () => {}) {
  return render(
    <ul>
      <BookingCard card={card(overrides)} onReservar={onReservar} />
    </ul>,
  )
}

// El botón nombra docente y horario: en un día con varias tarjetas todos
// dirían "Reservar".
const reservar = () =>
  screen.getByRole('button', { name: 'Reservar con Laura Gómez, 13:00 – 15:30' })

describe('BookingCard', () => {
  it('las materias que se pueden reservar mandan, y abajo con quién', () => {
    renderCard()
    expect(screen.getByText('Física · Matemática')).toBeInTheDocument()
    expect(screen.getByText('con Laura Gómez')).toBeInTheDocument()
  })

  it('dice el horario, que la duración la elige el alumno, y la modalidad', () => {
    renderCard()
    expect(screen.getByText('13:00 – 15:30')).toBeInTheDocument()
    expect(screen.getByText(/vos elegís cuánto dura/)).toBeInTheDocument()
    expect(screen.getByText('Virtual')).toBeInTheDocument()
    expect(screen.getByText('Individual')).toBeInTheDocument()
  })

  it('una presencial muestra la localidad', () => {
    renderCard({ modality: 'in_person', locality: 'Palermo, CABA' })
    expect(screen.getByText('Presencial · Palermo, CABA')).toBeInTheDocument()
  })

  it('con tarifas distintas muestra desde cuánto sale la hora', () => {
    renderCard()
    expect(screen.getByText(/^Desde \$\s5\.000\/h$/)).toBeInTheDocument()
  })

  it('con una sola tarifa muestra esa', () => {
    renderCard({ subjects: [{ id: 1, name: 'Matemática', hourlyRateCents: 550050 }] })
    expect(screen.getByText(/^\$\s5\.500,50\/h$/)).toBeInTheDocument()
  })

  it('una materia sin cargo lo dice', () => {
    renderCard({ subjects: [{ id: 1, name: 'Matemática', hourlyRateCents: 0 }] })
    expect(screen.getByText('Sin cargo')).toBeInTheDocument()
  })

  it('invita a sumarse a una grupal con lugar, con su materia', () => {
    renderCard({
      maxStudents: 4,
      groups: [
        {
          start: '13:00',
          end: '14:30',
          subjectId: 1,
          subjectName: 'Matemática',
          enrolled: 3,
          joined: false,
          blocked: false,
        },
      ],
    })
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    expect(screen.getByText('Sumate a Matemática de las 13:00: 3 de 4 anotados.')).toBeInTheDocument()
  })

  it('avisa si ya está anotado en esa grupal', () => {
    const anotado = {
      start: '13:00',
      end: '14:30',
      subjectId: 1,
      subjectName: 'Matemática',
      enrolled: 2,
      joined: true,
      blocked: true,
    }
    renderCard({ maxStudents: 4, groups: [anotado], joined: [anotado] })
    expect(screen.getByText('Ya estás anotado a las 13:00.')).toBeInTheDocument()
    expect(screen.queryByText(/Sumate/)).not.toBeInTheDocument()
  })

  it('avisa en gris con qué clase se superpone, y sigue siendo reservable', () => {
    renderCard({
      clashes: [
        {
          id: 'c1',
          subjectName: 'Física',
          teacherName: 'Carla Benítez',
          startTime: '13:00',
          endTime: '14:00',
        },
      ],
    })
    expect(
      screen.getByText('Se superpone con Física con Carla Benítez (13:00 – 14:00).'),
    ).toBeInTheDocument()
    expect(reservar()).toBeEnabled()
  })

  it('sin ningún horario libre no se puede reservar', () => {
    renderCard({ bookable: false })
    expect(reservar()).toBeDisabled()
  })

  it('el botón avisa que se quiere reservar esta tarjeta', async () => {
    const onReservar = vi.fn()
    renderCard({}, onReservar)
    await userEvent.click(reservar())
    expect(onReservar).toHaveBeenCalledTimes(1)
  })
})

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
    subject: { id: 1, name: 'Matemática' },
    start: '13:00',
    end: '15:30',
    durationMinutes: 90,
    price: 15000,
    modality: 'virtual',
    maxStudents: 1,
    address: null,
    slots: [
      { start: '13:00', end: '14:30', enrolled: 0, joined: false, blocked: false },
      { start: '13:30', end: '15:00', enrolled: 0, joined: false, blocked: false },
      { start: '14:00', end: '15:30', enrolled: 0, joined: false, blocked: false },
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

// El botón nombra materia y docente: en un día con varias tarjetas todos
// dirían "Reservar".
const reservar = () =>
  screen.getByRole('button', { name: 'Reservar Matemática con Laura Gómez' })

describe('BookingCard', () => {
  it('la materia manda, y abajo con quién', () => {
    renderCard()
    expect(screen.getByText('Matemática')).toBeInTheDocument()
    expect(screen.getByText('con Laura Gómez')).toBeInTheDocument()
  })

  it('dice el horario, cuánto dura cada clase y la modalidad', () => {
    renderCard()
    expect(screen.getByText('13:00 – 15:30')).toBeInTheDocument()
    expect(screen.getByText(/clases de 1 h 30 min/)).toBeInTheDocument()
    expect(screen.getByText('Virtual')).toBeInTheDocument()
    expect(screen.getByText('Individual')).toBeInTheDocument()
  })

  it('una presencial muestra la dirección', () => {
    renderCard({ modality: 'in_person', address: 'Aula 3' })
    expect(screen.getByText('Presencial · Aula 3')).toBeInTheDocument()
  })

  it('muestra el precio y cuántos horarios le quedan libres', () => {
    renderCard()
    expect(screen.getByText(/15\.000/)).toBeInTheDocument()
    expect(screen.getByText('· 3 horarios', { exact: false })).toBeInTheDocument()
  })

  it('una clase de precio 0 dice sin cargo', () => {
    renderCard({ price: 0 })
    expect(screen.getByText('Sin cargo', { exact: false })).toBeInTheDocument()
  })

  it('entiende duraciones libres', () => {
    renderCard({ durationMinutes: 45 })
    expect(screen.getByText(/clases de 45 min/)).toBeInTheDocument()
  })

  it('invita a sumarse a una grupal con lugar', () => {
    renderCard({
      maxStudents: 4,
      slots: [{ start: '13:00', end: '14:30', enrolled: 3, joined: false, blocked: false }],
    })
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    expect(screen.getByText('Sumate a la de las 13:00: 3 de 4 anotados.')).toBeInTheDocument()
  })

  it('avisa si ya está anotado en esa grupal', () => {
    const anotado = { start: '13:00', end: '14:30', enrolled: 2, joined: true, blocked: true }
    renderCard({ maxStudents: 4, slots: [anotado], joined: [anotado], bookable: false })
    expect(screen.getByText('Ya estás anotado a las 13:00.')).toBeInTheDocument()
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

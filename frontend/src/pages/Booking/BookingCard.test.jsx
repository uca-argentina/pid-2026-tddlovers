import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingCard from './BookingCard.jsx'

function card(overrides = {}) {
  return {
    id: '2026-09-14|2|1',
    date: '2026-09-14',
    dayKey: 'lunes',
    teacherId: 2,
    teacherName: 'Laura Gómez',
    subjectId: 1,
    subjectName: 'Matemática',
    ranges: [
      { start: '13:00', end: '15:30' },
      { start: '16:00', end: '17:00' },
    ],
    totalSlots: 7,
    clashes: [],
    free: [
      { start: '13:00', end: '15:30' },
      { start: '16:00', end: '17:00' },
    ],
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

// El botón se llama por la materia y el docente, no solo "Reservar": en un día
// con varias tarjetas todos dirían lo mismo.
const BOTON = 'Reservar Matemática con Laura Gómez'

const choqueConLaura = {
  id: 'sl-1',
  subjectName: 'Matemática',
  teacherName: 'Laura Gómez',
  startTime: '14:00',
  endTime: '15:00',
}

describe('BookingCard', () => {
  it('junta todos los tramos del día en una sola tarjeta', () => {
    renderCard()
    expect(screen.getByText('13:00 – 15:30 · 16:00 – 17:00')).toBeInTheDocument()
  })

  it('dice de qué materia y de qué docente es', () => {
    renderCard()
    expect(screen.getByText('Matemática')).toBeInTheDocument()
    expect(screen.getByText('Laura Gómez')).toBeInTheDocument()
  })

  it('muestra cuánto hay libre', () => {
    renderCard()
    expect(screen.getByText('3 h 30 min libres')).toBeInTheDocument()
  })

  it('sin superposiciones no hay aviso', () => {
    renderCard()
    expect(screen.queryByText(/Se superpone/)).not.toBeInTheDocument()
  })

  it('avisa en gris con qué clase se superpone', () => {
    renderCard({ clashes: [choqueConLaura] })
    expect(
      screen.getByText('Se superpone con Matemática con Laura Gómez (14:00 – 15:00).'),
    ).toBeInTheDocument()
  })

  it('una superposición parcial sigue siendo reservable', () => {
    // Solo choca un pedazo: el modal deja elegir adentro de lo que queda, así
    // que negarlo sería esconder disponibilidad de verdad.
    renderCard({ clashes: [choqueConLaura] })
    expect(screen.getByRole('button', { name: BOTON })).toBeEnabled()
  })

  it('si no queda una hora entera no se puede reservar', () => {
    renderCard({ clashes: [choqueConLaura], free: [], bookable: false })

    expect(screen.getByRole('button', { name: BOTON })).toBeDisabled()
    expect(screen.getByText(/^No te queda una hora libre/)).toBeInTheDocument()
  })

  it('el botón avisa que se quiere reservar esta tarjeta', async () => {
    const onReservar = vi.fn()
    renderCard({}, onReservar)

    await userEvent.click(screen.getByRole('button', { name: BOTON }))

    expect(onReservar).toHaveBeenCalledTimes(1)
  })
})

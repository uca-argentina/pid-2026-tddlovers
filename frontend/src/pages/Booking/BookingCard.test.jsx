import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import BookingCard from './BookingCard.jsx'
import { apiAvailabilityRow, startsBetween } from '../../testing/fixtures.js'

// Una fila de GET /api/availability, que es lo que recibe la tarjeta.
function card(overrides = {}) {
  return apiAvailabilityRow({
    teacherId: 2,
    start: '13:00',
    end: '15:30',
    subjects: [
      { id: 2, name: 'Física', hourlyRateCents: 600000 },
      { id: 1, name: 'Matemática', hourlyRateCents: 500000 },
    ],
    starts: startsBetween('13:00', '15:30'),
    ...overrides,
  })
}

function renderCard(overrides, onReservar = () => {}, props = {}) {
  return render(
    <ul>
      <BookingCard card={card(overrides)} onReservar={onReservar} {...props} />
    </ul>,
  )
}

// El botón nombra docente y horario: en un día con varias tarjetas todos
// dirían "Reservar".
const reservar = (extra = '') =>
  screen.getByRole('button', { name: `Reservar con Laura Gómez, 13:00 – 15:30${extra}` })

const grupal = (over = {}) => ({
  start: '13:00',
  end: '14:30',
  subjectId: 1,
  subjectName: 'Matemática',
  enrolled: 3,
  maxStudents: 4,
  ...over,
})

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
    renderCard({ maxStudents: 4, groups: [grupal()] })
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    expect(screen.getByText('Sumate a Matemática de las 13:00: 3 de 4 anotados.')).toBeInTheDocument()
  })

  it('el "n de M" usa el cupo del turno, no el de la ventana', () => {
    // La ventana se agrandó a 6 después de que se armó una grupal de 4.
    renderCard({ maxStudents: 6, groups: [grupal({ enrolled: 2, maxStudents: 4 })] })
    expect(screen.getByText('Sumate a Matemática de las 13:00: 2 de 4 anotados.')).toBeInTheDocument()
  })

  it('una tarjeta que llegó del backend siempre se puede reservar', () => {
    renderCard({ starts: [], groups: [grupal()] })
    expect(reservar()).toBeEnabled()
  })

  it('de licencia se ve apagada y no se puede reservar', () => {
    renderCard({ onVacation: true, starts: [], groups: [] })
    expect(screen.getByText('El docente está de licencia este día.')).toBeInTheDocument()
    expect(reservar(', de licencia')).toBeDisabled()
  })

  it('el botón avisa que se quiere reservar esta tarjeta', async () => {
    const onReservar = vi.fn()
    renderCard({}, onReservar)
    await userEvent.click(reservar())
    expect(onReservar).toHaveBeenCalledTimes(1)
  })

  it('con un paquete que sirve dice cuántas clases le quedan', () => {
    renderCard({}, () => {}, { pack: { available: 2, classMinutes: 60 } })
    expect(screen.getByText('Te quedan 2 clases de 1 h del paquete.')).toBeInTheDocument()
  })
})

describe('BookingCard — neuronas', () => {
  it('muestra las etiquetas de Destacado y de canjes', () => {
    renderCard({ teacherFeatured: true, teacherAcceptsRewards: true })
    expect(screen.getByText('Destacado')).toBeInTheDocument()
    expect(screen.getByText('Acepta neuronas')).toBeInTheDocument()
  })

  it('sin nada de eso no muestra etiquetas', () => {
    renderCard({})
    expect(screen.queryByText('Destacado')).not.toBeInTheDocument()
    expect(screen.queryByText('Acepta neuronas')).not.toBeInTheDocument()
  })
})

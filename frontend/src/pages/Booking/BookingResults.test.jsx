import { render, screen } from '@testing-library/react'
import BookingResults from './BookingResults.jsx'
import { apiAvailabilityRow, apiStudentPack } from '../../testing/fixtures.js'

function renderResults(props = {}) {
  return render(<BookingResults date={new Date(2099, 8, 14)} {...props} />)
}

describe('BookingResults', () => {
  it('cuenta para reservar solo las que no están de licencia', () => {
    renderResults({
      cards: [
        apiAvailabilityRow({ id: 'a' }),
        apiAvailabilityRow({ id: 'b', onVacation: true, starts: [] }),
      ],
    })
    expect(screen.getByText('1 clase para reservar')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Reservar con/ })).toHaveLength(2)
  })

  it('la tarjeta muestra el paquete que sirve ESE día, no el que vence primero', () => {
    // Bug: se mostraba el que vencía primero aunque no tuviera clases o
    // venciera antes del día de la tarjeta.
    renderResults({
      cards: [apiAvailabilityRow()],
      packs: [
        apiStudentPack({ id: 'vence-antes', expiresOn: '2099-09-01', available: 5 }),
        apiStudentPack({ id: 'sin-clases', expiresOn: '2099-09-10', available: 0, usable: false }),
        apiStudentPack({ id: 'sirve', expiresOn: '2099-10-01', available: 1, classMinutes: 90 }),
      ],
    })
    expect(screen.getByText('Te queda 1 clase de 1 h 30 min del paquete.')).toBeInTheDocument()
  })

  it('sin un paquete que sirva ese día no dice nada del paquete', () => {
    renderResults({
      cards: [apiAvailabilityRow()],
      packs: [apiStudentPack({ expiresOn: '2099-09-01' })],
    })
    expect(screen.queryByText(/del paquete/)).not.toBeInTheDocument()
  })
})

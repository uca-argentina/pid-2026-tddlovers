import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import ClassCard from './ClassCard.jsx'
import { apiBooking } from '../testing/fixtures.js'

vi.mock('../api/client.js', () => ({
  acceptClass: vi.fn(),
  cancelClass: vi.fn(),
  cancelBooking: vi.fn(),
  payBooking: vi.fn(),
}))

const clase = { teacherId: 't1', date: '2099-09-14', startTime: '13:00', maxStudents: 3 }
const sofia = apiBooking({ ...clase, id: 'r1', studentName: 'Sofía Ramírez' })
const ana = apiBooking({
  ...clase,
  id: 'r2',
  studentName: 'Ana Pérez',
  priceCents: 0,
  rewardType: 'free_60',
})

function renderCard(props) {
  return render(
    <MemoryRouter>
      <ClassCard cls={sofia} rows={[sofia, ana]} viewRole="teacher" {...props} />
    </MemoryRouter>,
  )
}

describe('ClassCard', () => {
  it('en una grupal el docente ve el rango de precios, sin el canje de un alumno', () => {
    renderCard()
    const meta = screen.getByText(/Grupal · 2 de 3/)
    expect(meta).toHaveTextContent(/Sin cargo – \$\s5\.000 c\/u$/)
    expect(meta).not.toHaveTextContent('neuronas')
  })

  it('si todos pagan lo mismo, un solo precio c/u', () => {
    renderCard({ rows: [sofia, { ...ana, priceCents: 500000, rewardType: null }] })
    expect(screen.getByText(/Grupal · 2 de 3/)).toHaveTextContent(/· \$\s5\.000 c\/u$/)
  })

  it('el alumno ve su precio y con qué lo cubre', () => {
    renderCard({ cls: ana, rows: [ana], viewRole: 'student' })
    expect(screen.getByText(/Docente:/)).toHaveTextContent(/Sin cargo · 1 h gratis con neuronas$/)
  })
})

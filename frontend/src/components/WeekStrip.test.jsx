import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import WeekStrip from './WeekStrip.jsx'

// La semana del lunes 12 al domingo 18 de octubre de 2026; hoy es el martes.
function semana() {
  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(2026, 9, 12 + i)
    const iso = `2026-10-${String(12 + i).padStart(2, '0')}`
    return { iso, date, isToday: i === 1, marked: i === 3, muted: false }
  })
}

function renderStrip(props = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onPrev: vi.fn(),
    onNext: vi.fn(),
    onToday: vi.fn(),
    onToggleExpanded: vi.fn(),
  }
  render(
    <WeekStrip title="Octubre de 2026" days={semana()} selectedIso="2026-10-13" {...handlers} {...props}>
      <p>La grilla del mes</p>
    </WeekStrip>,
  )
  return handlers
}

describe('WeekStrip', () => {
  it('muestra los siete días, con el elegido y los que tienen algo', () => {
    renderStrip()

    const dias = screen.getAllByRole('button', { pressed: false }).concat(
      screen.getAllByRole('button', { pressed: true }),
    )
    expect(dias).toHaveLength(7)
    expect(screen.getByRole('button', { name: 'Martes, 13 de octubre, hoy' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Jueves, 15 de octubre, hay clases' })).toBeInTheDocument()
  })

  it('tocar un día lo elige', async () => {
    const { onSelect } = renderStrip()
    await userEvent.click(screen.getByRole('button', { name: /Viernes, 16/ }))
    expect(onSelect).toHaveBeenCalledWith('2026-10-16')
  })

  it('las flechas pasan de semana', async () => {
    const { onPrev, onNext } = renderStrip()
    await userEvent.click(screen.getByRole('button', { name: 'Semana anterior' }))
    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('deslizar el dedo a la izquierda pasa a la semana siguiente', () => {
    const { onNext, onPrev } = renderStrip()
    const dias = screen.getByRole('group', { name: 'Días de la semana' })

    fireEvent.pointerDown(dias, { clientX: 200 })
    fireEvent.pointerUp(dias, { clientX: 100 })
    expect(onNext).toHaveBeenCalledTimes(1)

    // Un toque apenas torcido no cuenta.
    fireEvent.pointerDown(dias, { clientX: 200 })
    fireEvent.pointerUp(dias, { clientX: 185 })
    expect(onPrev).not.toHaveBeenCalled()
    expect(onNext).toHaveBeenCalledTimes(1)
  })

  it('desplegada muestra el mes en vez de los días', () => {
    renderStrip({ expandable: true, expanded: true })

    expect(screen.getByText('La grilla del mes')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Días de la semana' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Mes/ })).toHaveAttribute('aria-expanded', 'true')
  })
})

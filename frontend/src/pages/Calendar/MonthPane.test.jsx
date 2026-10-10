import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import MonthPane from './MonthPane.jsx'

// Siempre la versión de teléfono: `mobile` explícito le gana a withViewport.
function renderMobile(props = {}) {
  const onSelectDay = vi.fn()
  const onRangeChange = vi.fn()
  const utils = render(
    <MonthPane
      mobile
      selectedIso="2026-10-14"
      onSelectDay={onSelectDay}
      onRangeChange={onRangeChange}
      {...props}
    />,
  )
  return { ...utils, onSelectDay, onRangeChange }
}

describe('MonthPane en el teléfono', () => {
  it('muestra la tira de la semana del día elegido, con el mes y el año de título', () => {
    renderMobile({ eventsByDate: { '2026-10-15': [{ id: 'c1' }] } })

    expect(screen.getByRole('heading', { name: 'Octubre 2026' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Miércoles, 14 de octubre/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Jueves, 15 de octubre, hay clases' })).toBeInTheDocument()
  })

  it('la flecha pasa al mismo día de la semana siguiente', async () => {
    const { onSelectDay } = renderMobile()

    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))

    expect(onSelectDay).toHaveBeenCalledWith('2026-10-21')
  })

  it('pasar a una semana de otro mes pide el rango de ese mes', async () => {
    const { onSelectDay, onRangeChange, rerender } = renderMobile({ selectedIso: '2026-10-28' })
    onRangeChange.mockClear()

    await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }))
    expect(onSelectDay).toHaveBeenCalledWith('2026-11-04')
    rerender(
      <MonthPane
        mobile
        selectedIso="2026-11-04"
        onSelectDay={onSelectDay}
        onRangeChange={onRangeChange}
      />,
    )

    // La grilla de noviembre arranca el lunes 26 de octubre.
    expect(onRangeChange).toHaveBeenCalledWith('2026-10-26', '2026-12-06')
  })

  it('"Mes" despliega la grilla y elegir un día vuelve a la tira', async () => {
    const { onSelectDay } = renderMobile()

    await userEvent.click(screen.getByRole('button', { name: /^Mes/ }))
    expect(screen.queryByRole('group', { name: 'Días de la semana' })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Viernes, 23 de octubre/ }))

    expect(onSelectDay).toHaveBeenCalledWith('2026-10-23')
    expect(screen.getByRole('group', { name: 'Días de la semana' })).toBeInTheDocument()
  })
})

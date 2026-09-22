import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HourTimeline from './HourTimeline.jsx'

// El docente da de 13:00 a 17:00; el alumno ya tiene algo de 14:00 a 15:00, así
// que lo reservable son 13:00–14:00 y 15:00–17:00.
const RANGOS = [{ start: '13:00', end: '17:00' }]
const LIBRE = [
  { start: '13:00', end: '14:00' },
  { start: '15:00', end: '17:00' },
]
const OCUPADO = [
  {
    id: 'sl-1',
    startTime: '14:00',
    endTime: '15:00',
    subjectName: 'Álgebra',
    teacherName: 'Martín Sosa',
  },
]

// La línea muestra de 12:00 a 18:00 (las horas del docente más media hora de
// cada lado), así que la columna 1 son las 12:00.
const COLUMNA_12 = 1

function renderLine(props = {}) {
  const onSelect = vi.fn()
  render(
    <HourTimeline ranges={RANGOS} free={LIBRE} busy={OCUPADO} onSelect={onSelect} {...props} />,
  )
  return { onSelect }
}

/** El botón de media hora que arranca a esa hora. */
function celda(hora, hasta) {
  return screen.getByRole('button', { name: `${hora} a ${hasta}` })
}

/** Dónde arranca y cuánto dura una barra, en columnas de media hora. */
function barra(clase) {
  const el = document.querySelector(`.hour-bar.${clase}`)
  return el ? el.style.gridColumn : null
}

describe('HourTimeline', () => {
  it('muestra las horas del docente con un rato antes y después', () => {
    // No el día entero: así cada media hora es ancha y se entiende de un
    // vistazo. De 12:00 a 18:00 son 12 medias horas.
    renderLine()

    const picks = screen.getAllByRole('button')
    expect(picks).toHaveLength(12)
    expect(picks[0]).toHaveAttribute('aria-label', '12:00 a 13:00')
    expect(picks[picks.length - 1]).toHaveAttribute('aria-label', '17:30 a 18:30')
  })

  it('no se pasa de la medianoche al recortar', () => {
    renderLine({ ranges: [{ start: '23:00', end: '24:00' }], free: [], busy: [] })

    const picks = screen.getAllByRole('button')
    expect(picks[picks.length - 1]).toHaveAttribute('aria-label', '23:30 a 24:00')
  })

  it('las horas del docente son UNA barra verde, no ocho pedazos', () => {
    renderLine()
    // 13:00 es la columna 3 y hasta las 17:00 hay 8 medias horas.
    expect(document.querySelectorAll('.hour-bar.is-free')).toHaveLength(1)
    expect(barra('is-free')).toBe(`${COLUMNA_12 + 2} / span 8`)
  })

  it('lo que el alumno ya tiene va en gris, sea de quien sea', () => {
    renderLine()
    expect(barra('is-busy')).toBe(`${COLUMNA_12 + 4} / span 2`)
  })

  it('la barra gris dice adentro de qué clase es', () => {
    // Sin esto el gris no se entiende: dice "no podés" y no dice por qué.
    renderLine()

    const materia = screen.getByText('Álgebra')
    expect(materia.closest('.hour-bar')).toHaveClass('is-busy')
    expect(screen.getByText('Martín Sosa').closest('.hour-bar')).toBe(materia.closest('.hour-bar'))
  })

  it('solo se puede arrancar donde entra la clase entera', () => {
    renderLine()
    // 13:00–14:00 da un solo arranque: a las 13:30 ya no entra la hora.
    expect(celda('13:00', '14:00')).toBeEnabled()
    expect(celda('13:30', '14:30')).toBeDisabled()
    // 15:00–17:00 deja arrancar hasta las 16:00.
    expect(celda('16:00', '17:00')).toBeEnabled()
    expect(celda('16:30', '17:30')).toBeDisabled()
    // Fuera del horario del docente, nada.
    expect(celda('12:00', '13:00')).toBeDisabled()
  })

  it('elegir avisa con el índice de media hora', async () => {
    const { onSelect } = renderLine()

    await userEvent.click(celda('15:30', '16:30'))

    // 15:30 son 31 medias horas desde las 00:00.
    expect(onSelect).toHaveBeenCalledWith(31)
  })

  it('lo elegido se pinta de azul lleno y dura exactamente una hora', () => {
    renderLine({ value: 30 })

    expect(barra('is-selected')).toBe(`${COLUMNA_12 + 6} / span 2`)
  })

  it('señalar una hora la muestra en un azul más suave', async () => {
    renderLine()

    await userEvent.hover(celda('15:00', '16:00'))

    expect(barra('is-hover')).toBe(`${COLUMNA_12 + 6} / span 2`)
    expect(barra('is-selected')).toBeNull()
  })

  it('con una hora ya elegida, señalar otra sigue mostrando qué pasaría', async () => {
    // Las dos barras conviven: la elegida no se mueve hasta que se haga clic.
    renderLine({ value: 26 })

    await userEvent.hover(celda('15:00', '16:00'))

    expect(barra('is-selected')).toBe(`${COLUMNA_12 + 2} / span 2`)
    expect(barra('is-hover')).toBe(`${COLUMNA_12 + 6} / span 2`)
  })

  it('señalar la hora ya elegida no dibuja dos barras', async () => {
    renderLine({ value: 30 })

    await userEvent.hover(celda('15:00', '16:00'))

    expect(barra('is-hover')).toBeNull()
  })

  it('señalar una hora que no se puede tomar no propone nada', async () => {
    renderLine()

    await userEvent.hover(celda('13:30', '14:30'))

    expect(barra('is-hover')).toBeNull()
  })

  it('sin clases propias no muestra la referencia del gris', () => {
    renderLine({ busy: [] })
    expect(screen.queryByText('Ya tenés clase')).not.toBeInTheDocument()
  })
})

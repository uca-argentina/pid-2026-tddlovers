import { render, screen } from '@testing-library/react'
import DayCell from './DayCell.jsx'

const cell = {
  date: new Date(2026, 8, 14),
  iso: '2026-09-14',
  day: 14,
  inMonth: true,
  isToday: false,
  isWeekend: false,
}

function lesson(id, startTime, subjectName) {
  return { id, startTime, subjectName, status: 'disponible' }
}

function renderCell(props) {
  return render(<DayCell cell={cell} onSelect={() => {}} {...props} />)
}

describe('DayCell', () => {
  it('muestra la hora y la materia de cada clase', () => {
    renderCell({ events: [lesson('a', '09:00', 'Física')], maxVisible: 3 })
    expect(screen.getByText('09:00')).toBeInTheDocument()
    expect(screen.getByText('Física')).toBeInTheDocument()
  })

  it('muestra todas las clases si entran', () => {
    const events = [lesson('a', '09:00', 'Física'), lesson('b', '10:30', 'Inglés')]
    renderCell({ events, maxVisible: 2 })

    expect(screen.getByText('Física')).toBeInTheDocument()
    expect(screen.getByText('Inglés')).toBeInTheDocument()
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument()
  })

  it('corta con un "+N" cuando no entran', () => {
    const events = [
      lesson('a', '09:00', 'Física'),
      lesson('b', '10:30', 'Inglés'),
      lesson('c', '14:00', 'Química'),
      lesson('d', '16:30', 'Álgebra'),
    ]
    renderCell({ events, maxVisible: 3 })

    // Con lugar para 3 líneas y 4 clases, una línea se la lleva el "+N", así
    // que se ven 2 clases y quedan 2 escondidas.
    expect(screen.getByText('Física')).toBeInTheDocument()
    expect(screen.getByText('Inglés')).toBeInTheDocument()
    expect(screen.queryByText('Química')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('sin lugar para ninguna, avisa cuántas hay', () => {
    const events = [lesson('a', '09:00', 'Física'), lesson('b', '10:30', 'Inglés')]
    renderCell({ events, maxVisible: 0 })

    expect(screen.queryByText('Física')).not.toBeInTheDocument()
    expect(screen.getByText('+2')).toBeInTheDocument()
  })

  it('muestra los horarios libres en verde', () => {
    renderCell({ events: [], freeCount: 3, maxVisible: 3 })
    expect(screen.getByText('3')).toBeInTheDocument()
    expect(screen.getByText('libres')).toBeInTheDocument()
    expect(screen.getByRole('button').className).toContain('is-free')
  })

  it('sin horarios libres no hay línea verde ni tinte', () => {
    renderCell({ events: [], freeCount: 0, maxVisible: 3 })
    expect(screen.queryByText('libres')).not.toBeInTheDocument()
    expect(screen.getByRole('button').className).not.toContain('is-free')
  })

  it('la línea verde se lleva un renglón antes que las clases', () => {
    // Con lugar para 3 líneas, la verde toma una y quedan 2 para las clases:
    // como hay 4, una se usa para el "+N" y se ve una sola.
    const events = [
      lesson('a', '09:00', 'Física'),
      lesson('b', '10:30', 'Inglés'),
      lesson('c', '14:00', 'Química'),
      lesson('d', '16:30', 'Álgebra'),
    ]
    renderCell({ events, freeCount: 2, maxVisible: 3 })

    expect(screen.getByText('Física')).toBeInTheDocument()
    expect(screen.queryByText('Inglés')).not.toBeInTheDocument()
    expect(screen.getByText('+3')).toBeInTheDocument()
    expect(screen.getByText('libres')).toBeInTheDocument()
  })

  it('la etiqueta accesible nombra los horarios libres solo si hay', () => {
    renderCell({ events: [lesson('a', '09:00', 'Física')], freeCount: 2, maxVisible: 3 })
    expect(screen.getByRole('button')).toHaveAccessibleName(/1 clase, 2 horarios libres$/)
  })

  it('cuenta las clases en la etiqueta accesible', () => {
    renderCell({ events: [lesson('a', '09:00', 'Física')], maxVisible: 3 })
    expect(screen.getByRole('button')).toHaveAccessibleName(/1 clase$/)
  })

  it('avisa cuando el día no tiene clases', () => {
    renderCell({ events: [], maxVisible: 3 })
    expect(screen.getByRole('button')).toHaveAccessibleName(/sin clases$/)
  })
})

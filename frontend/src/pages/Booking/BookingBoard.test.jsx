import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BookingBoard from './BookingBoard.jsx'
import withRouter from '../../routes/withRouter.jsx'
import { toISODate } from '../../utils/calendar.js'
import { dayKeyFromIso } from '../../utils/booking.js'

const { bookLesson, fetchAvailability, fetchMyLessons, fetchSubjects } = vi.hoisted(() => ({
  bookLesson: vi.fn(),
  fetchAvailability: vi.fn(),
  fetchMyLessons: vi.fn(),
  fetchSubjects: vi.fn(),
}))

// La fábrica reemplaza el módulo ENTERO: lo que no esté acá llega como
// undefined. bookLesson lo usa BookingDialog, no el tablero.
vi.mock('../../api/client.js', () => ({
  bookLesson,
  fetchAvailability,
  fetchMyLessons,
  fetchSubjects,
}))

const MATERIAS = [
  { id: 1, name: 'Matemática' },
  { id: 2, name: 'Física' },
]

const alumno = { id: 7, nombre: 'Sofía', role: 'student' }

// Todo se arma sobre HOY, que es el día que la pantalla trae seleccionado.
const HOY = toISODate(new Date())
const DIA_HOY = dayKeyFromIso(HOY)

/** Los turnos de a media hora de una ventana, como los arma el backend. */
function turnos(start, end, duracion = 60) {
  const aMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
  const aHora = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
  const lista = []
  for (let m = aMin(start); m + duracion <= aMin(end); m += 30) {
    lista.push({ start: aHora(m), end: aHora(m + duracion), enrolled: 0 })
  }
  return lista
}

// Una fila de /api/availability: una clase de Laura, hoy, de 13 a 17.
function slot(overrides = {}) {
  return {
    id: `w-laura|${HOY}`,
    windowId: 'w-laura',
    date: HOY,
    dayKey: DIA_HOY,
    teacherId: 2,
    teacherName: 'Laura Gómez',
    subject: { id: 1, name: 'Matemática' },
    start: '13:00',
    end: '17:00',
    durationMinutes: 60,
    price: 15000,
    modality: 'virtual',
    maxStudents: 1,
    address: null,
    slots: turnos('13:00', '17:00'),
    ...overrides,
  }
}

// Carla da Física presencial y grupal, a la mañana.
const carla = (overrides = {}) =>
  slot({
    id: `w-carla|${HOY}`,
    windowId: 'w-carla',
    teacherId: 4,
    teacherName: 'Carla Benítez',
    subject: { id: 2, name: 'Física' },
    start: '09:00',
    end: '11:00',
    modality: 'in_person',
    locality: 'Puerto Madero',
    maxStudents: 4,
    slots: turnos('09:00', '11:00'),
    ...overrides,
  })

// BookingBoard recibe `router` por props, así que para el test lo envolvemos
// igual que hace AvailabilityPage.
const BoardConRouter = withRouter(BookingBoard)

function renderBoard(path = '/disponibilidad', props = {}) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/disponibilidad" element={<BoardConRouter user={alumno} {...props} />} />
      </Routes>
    </MemoryRouter>,
  )
}

function esperarCarga() {
  return waitFor(() => expect(screen.queryByText('Buscando horarios...')).not.toBeInTheDocument())
}

/**
 * Los filtros viven en secciones plegables que arrancan cerradas, así que hay
 * que abrirlas antes de llegar a los chips — igual que el alumno. Si ya está
 * abierta (porque el filtro venía elegido) no la toca.
 */
async function abrirFiltro(nombre) {
  const head = screen.getByRole('button', { name: new RegExp(`^${nombre}`) })
  if (head.getAttribute('aria-expanded') === 'false') await userEvent.click(head)
}

describe('BookingBoard', () => {
  beforeEach(() => {
    bookLesson.mockReset().mockResolvedValue({ lesson: {} })
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    fetchMyLessons.mockReset().mockResolvedValue([])
    fetchAvailability.mockReset().mockResolvedValue([slot()])
  })

  it('pide la disponibilidad del rango que abarca la grilla', async () => {
    renderBoard()
    await esperarCarga()

    expect(fetchAvailability).toHaveBeenCalledTimes(1)
    const { from, to } = fetchAvailability.mock.calls[0][0]
    expect(from <= HOY && HOY <= to).toBe(true)
  })

  it('muestra las clases del día seleccionado', async () => {
    renderBoard()
    await esperarCarga()

    expect(await screen.findByText('13:00 – 17:00')).toBeInTheDocument()
    // Dentro de la tarjeta: "Individual" también es un chip de los filtros.
    const tarjeta = screen.getByText('con Laura Gómez').closest('li')
    expect(within(tarjeta).getByText('Individual')).toBeInTheDocument()
  })

  it('una tarjeta por clase ofrecida, con su materia, modalidad y cupo', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    expect(await screen.findAllByRole('button', { name: /^Reservar / })).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Reservar Física con Carla Benítez' })).toBeEnabled()
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    // La zona, nunca la dirección exacta: esa llega recién al reservar.
    expect(screen.getByText('Presencial · Puerto Madero')).toBeInTheDocument()
  })

  it('una grupal con lugar invita a sumarse', async () => {
    const [primero, ...resto] = turnos('09:00', '11:00')
    fetchAvailability.mockResolvedValue([
      carla({ slots: [{ ...primero, enrolled: 2 }, ...resto.slice(2)] }),
    ])
    renderBoard()
    await esperarCarga()

    expect(
      await screen.findByText('Sumate a la de las 09:00: 2 de 4 anotados.'),
    ).toBeInTheDocument()
  })

  it('avisa cuando se superpone con una clase propia', async () => {
    fetchMyLessons.mockResolvedValue([
      {
        id: 'sl-1',
        date: HOY,
        teacherId: 4,
        teacherName: 'Carla Benítez',
        subjectId: 2,
        subjectName: 'Física',
        startTime: '14:00',
        endTime: '15:00',
      },
    ])
    renderBoard()
    await esperarCarga()

    expect(await screen.findByText(/Se superpone con Física con Carla Benítez/)).toBeInTheDocument()
    // Sigue reservable: quedan 13:00–14:00 y 15:00–17:00.
    expect(screen.getByRole('button', { name: /^Reservar / })).toBeEnabled()
  })

  it('filtra por día', async () => {
    renderBoard()
    await esperarCarga()
    expect(await screen.findByText('13:00 – 17:00')).toBeInTheDocument()

    // Elegimos un día que NO es el de la tarjeta.
    const otroDia = DIA_HOY === 'lunes' ? 'Martes' : 'Lunes'
    await abrirFiltro('Días')
    await userEvent.click(screen.getByRole('button', { name: otroDia }))

    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('filtra por materia', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    await abrirFiltro('Materias')
    await userEvent.click(await screen.findByRole('button', { name: 'Física' }))

    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('filtra por modalidad y por tipo de clase', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    await abrirFiltro('Modalidad')
    await userEvent.click(screen.getByRole('button', { name: 'Presencial' }))
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()

    await abrirFiltro('Tipo de clase')
    await userEvent.click(screen.getByRole('button', { name: 'Individual' }))
    expect(screen.queryByText('09:00 – 11:00')).not.toBeInTheDocument()
  })

  it('solo ofrece chips de materias que están en el rango cargado', async () => {
    // Un chip que solo puede devolver cero es una trampa: si nadie da Física
    // en este mes, no tiene sentido poder filtrarla.
    renderBoard()
    await esperarCarga()
    await abrirFiltro('Materias')

    expect(await screen.findByRole('button', { name: 'Matemática' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Física' })).not.toBeInTheDocument()
  })

  it('filtra por hora de arranque', async () => {
    renderBoard()
    await esperarCarga()
    await abrirFiltro('Horario')
    // El slider es un <input type="range">: se cambia con fireEvent porque
    // userEvent no sabe arrastrar una manija.
    const desde = screen.getByLabelText('Desde')

    // 13:00–17:00 ofrece arrancar hasta las 16:00.
    fireEvent.change(desde, { target: { value: '15' } })
    expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()

    fireEvent.change(desde, { target: { value: '17' } })
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('las manijas del horario no se cruzan', async () => {
    // Sin esto se podría armar un rango invertido, que no devuelve nada y
    // obligaba a un cartel de advertencia.
    renderBoard()
    await esperarCarga()
    await abrirFiltro('Horario')

    const desde = screen.getByLabelText('Desde')
    const hasta = screen.getByLabelText('Hasta')

    fireEvent.change(hasta, { target: { value: '10' } })
    // Se la empuja más allá de "hasta": queda una hora antes, no después.
    fireEvent.change(desde, { target: { value: '20' } })

    expect(Number(desde.value)).toBeLessThan(Number(hasta.value))
  })

  it('el número verde del día es cuántas tarjetas hay', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    // El día de hoy muestra "2" en verde y, al tocarlo, hay 2 tarjetas.
    const celda = screen.getByRole('button', { name: new RegExp('2 horarios libres$') })
    expect(celda).toBeInTheDocument()
    await userEvent.click(celda)
    expect(await screen.findAllByRole('button', { name: /^Reservar / })).toHaveLength(2)
  })

  it('buscar una materia la deja elegida', async () => {
    renderBoard('/disponibilidad?q=matematica')
    await esperarCarga()

    expect(await screen.findByRole('button', { name: 'Matemática' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('buscar un docente filtra y se puede sacar', async () => {
    renderBoard('/disponibilidad?q=gomez')
    await esperarCarga()

    expect(await screen.findByText('13:00 – 17:00')).toBeInTheDocument()
    const chip = screen.getByLabelText('Quitar el filtro por docente')
    expect(chip).toHaveTextContent('gomez')

    await userEvent.click(chip)
    expect(screen.queryByLabelText('Quitar el filtro por docente')).not.toBeInTheDocument()
  })

  it('buscar un docente que no existe no deja nada', async () => {
    renderBoard('/disponibilidad?q=inexistente')
    await esperarCarga()

    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('"Limpiar filtros" vuelve a mostrar todo', async () => {
    renderBoard()
    await esperarCarga()

    const otroDia = DIA_HOY === 'lunes' ? 'Martes' : 'Lunes'
    await abrirFiltro('Días')
    await userEvent.click(screen.getByRole('button', { name: otroDia }))
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Limpiar filtros' }))
    expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()
  })

  it('distingue "no hay nada" de "los filtros no dejan nada"', async () => {
    fetchAvailability.mockResolvedValue([])
    renderBoard()
    await esperarCarga()
    expect(screen.getByText('No hay horarios libres ese día.')).toBeInTheDocument()

    const otroDia = DIA_HOY === 'lunes' ? 'Martes' : 'Lunes'
    await abrirFiltro('Días')
    await userEvent.click(screen.getByRole('button', { name: otroDia }))
    expect(
      screen.getByText('Ningún horario libre de ese día coincide con los filtros.'),
    ).toBeInTheDocument()
  })

  it('avisa si falla la carga', async () => {
    fetchAvailability.mockRejectedValue(new Error('Se cayó todo.'))
    renderBoard()

    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })

  it('reservar abre el modal con los datos de esa tarjeta', async () => {
    renderBoard()
    await esperarCarga()

    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    const modal = screen.getByRole('dialog')
    expect(modal).toHaveTextContent('Matemática')
    expect(modal).toHaveTextContent('Laura Gómez')
  })

  it('confirmar reserva manda la ventana, el día y la hora, y recarga el mes', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    // 13:00–17:00 con clases de 1 h ofrece 7 arranques: hay que elegir uno.
    await userEvent.click(screen.getByRole('button', { name: '14:00 a 15:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() => expect(bookLesson).toHaveBeenCalledTimes(1))
    // La materia no se manda: es de la ventana.
    expect(bookLesson).toHaveBeenCalledWith({ windowId: 'w-laura', date: HOY, startTime: '14:00' })
    // Se vuelve a pedir todo: ese horario puede pasar a chocar con las
    // tarjetas de otros docentes.
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('avisa que quedó reservada', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    await userEvent.click(screen.getByRole('button', { name: '14:00 a 15:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reservaste Matemática con Laura Gómez',
    )
  })

  it('en una grupal se puede sumar a un turno armado', async () => {
    fetchAvailability.mockResolvedValue([
      carla({
        slots: [
          { start: '09:00', end: '10:00', enrolled: 3 },
          { start: '10:00', end: '11:00', enrolled: 0 },
        ],
      }),
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reservar Física con Carla Benítez' }),
    )

    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Sumate a una clase grupal')).toBeInTheDocument()
    await userEvent.click(
      within(modal).getByRole('button', { name: '09:00 a 10:00, 3 de 4 anotados' }),
    )
    expect(within(modal).getByText(/te sumás a una clase grupal/)).toBeInTheDocument()
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(bookLesson).toHaveBeenCalledWith({ windowId: 'w-carla', date: HOY, startTime: '09:00' }),
    )
  })

  it('en una presencial el modal dice la localidad y que la dirección llega al reservar', async () => {
    fetchAvailability.mockResolvedValue([carla()])
    renderBoard()
    await esperarCarga()
    await userEvent.click(
      await screen.findByRole('button', { name: 'Reservar Física con Carla Benítez' }),
    )

    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Puerto Madero')).toBeInTheDocument()
    expect(
      within(modal).getByText('La dirección exacta te aparece en tu calendario cuando reserves.'),
    ).toBeInTheDocument()
  })

  it('los horarios que chocan con una clase propia no se pueden elegir', async () => {
    fetchMyLessons.mockResolvedValue([
      {
        id: 'mia',
        date: HOY,
        teacherId: 4,
        teacherName: 'Carla Benítez',
        subjectName: 'Física',
        startTime: '14:00',
        endTime: '15:00',
      },
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    expect(
      screen.getByRole('button', { name: '14:00 a 15:00, ya tenés otra clase' }),
    ).toBeDisabled()
    expect(screen.getByRole('button', { name: '15:00 a 16:00' })).toBeEnabled()
  })

  it('con un solo horario posible llega elegido', async () => {
    fetchAvailability.mockResolvedValue([slot({ slots: turnos('13:00', '14:00') })])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    expect(screen.getByRole('button', { name: 'Confirmar reserva' })).toBeEnabled()
  })

  it('si falla la reserva el modal se queda con el error', async () => {
    bookLesson.mockRejectedValue(new Error('Ya la tomó otro.'))
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    await userEvent.click(screen.getByRole('button', { name: '14:00 a 15:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Ya la tomó otro.')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(fetchAvailability).toHaveBeenCalledTimes(1)
  })

  it('cancelar cierra el modal sin reservar', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(bookLesson).not.toHaveBeenCalled()
  })

  it('sin usuario no pide las clases propias ni marca superposiciones', async () => {
    renderBoard('/disponibilidad', { user: null })
    await esperarCarga()

    expect(fetchMyLessons).not.toHaveBeenCalled()
    expect(screen.queryByText(/Se superpone/)).not.toBeInTheDocument()
  })
})

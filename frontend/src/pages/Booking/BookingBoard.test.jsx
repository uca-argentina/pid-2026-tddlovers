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

// Una fila de /api/availability: Laura da Matemática virtual a $ 5.000/h,
// hoy de 13 a 17, y no tiene nada reservado.
function slot(overrides = {}) {
  return {
    id: `w-laura|${HOY}`,
    windowId: 'w-laura',
    date: HOY,
    dayKey: DIA_HOY,
    teacherId: 2,
    teacherName: 'Laura Gómez',
    start: '13:00',
    end: '17:00',
    modality: 'virtual',
    maxStudents: 1,
    locality: null,
    subjects: [{ id: 1, name: 'Matemática', hourlyRateCents: 500000 }],
    free: [{ start: '13:00', end: '17:00' }],
    groups: [],
    ...overrides,
  }
}

// Carla da Física (y Matemática) presencial y grupal, a la mañana.
const carla = (overrides = {}) =>
  slot({
    id: `w-carla|${HOY}`,
    windowId: 'w-carla',
    teacherId: 4,
    teacherName: 'Carla Benítez',
    start: '09:00',
    end: '11:00',
    modality: 'in_person',
    locality: 'Puerto Madero',
    maxStudents: 4,
    subjects: [
      { id: 2, name: 'Física', hourlyRateCents: 800000 },
      { id: 1, name: 'Matemática', hourlyRateCents: 700000 },
    ],
    free: [{ start: '09:00', end: '11:00' }],
    ...overrides,
  })

const RESERVAR_CARLA = 'Reservar con Carla Benítez, 09:00 – 11:00'

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

  it('una tarjeta por horario ofrecido, con sus materias, modalidad y cupo', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    expect(await screen.findAllByRole('button', { name: /^Reservar / })).toHaveLength(2)
    expect(screen.getByRole('button', { name: RESERVAR_CARLA })).toBeEnabled()
    expect(screen.getByText('Física · Matemática')).toBeInTheDocument()
    expect(screen.getByText('Grupal · hasta 4')).toBeInTheDocument()
    // La zona, nunca la dirección exacta: esa llega recién al reservar.
    expect(screen.getByText('Presencial · Puerto Madero')).toBeInTheDocument()
  })

  it('una grupal con lugar invita a sumarse', async () => {
    fetchAvailability.mockResolvedValue([
      carla({
        free: [{ start: '10:00', end: '11:00' }],
        groups: [{ start: '09:00', end: '10:00', subjectId: 2, subjectName: 'Física', enrolled: 2 }],
      }),
    ])
    renderBoard()
    await esperarCarga()

    expect(
      await screen.findByText('Sumate a Física de las 09:00: 2 de 4 anotados.'),
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

  it('filtra por materia: pasa el horario que la ofrece entre otras', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard()
    await esperarCarga()

    await abrirFiltro('Materias')
    await userEvent.click(await screen.findByRole('button', { name: 'Física' }))
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()

    // Matemática la dan las dos: vuelven las dos tarjetas.
    await userEvent.click(screen.getByRole('button', { name: 'Física' }))
    await userEvent.click(screen.getByRole('button', { name: 'Matemática' }))
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()
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

    // 13:00–17:00 ofrece arrancar hasta las 16:30 (una clase de 30 min). El
    // slider del filtro va de a hora.
    fireEvent.change(desde, { target: { value: '16' } })
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

  it('arma la clase: hora, duración y precio calculado, y recarga el mes', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    const modal = screen.getByRole('dialog')

    // Una sola materia: ya viene elegida. Falta la hora.
    expect(within(modal).getByRole('button', { name: /^Matemática/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(modal).getByRole('button', { name: 'Confirmar reserva' })).toBeDisabled()

    await userEvent.click(within(modal).getByRole('button', { name: '14:00' }))
    // Arranca en 1 h, y deja hasta lo que entra (14:00 a 17:00 = 3 h).
    const duracion = within(modal).getByLabelText('¿Cuánto dura?')
    expect(duracion).toHaveValue('60')
    expect(within(duracion).getAllByRole('option').at(-1)).toHaveTextContent('3 h (hasta las 17:00)')

    await userEvent.selectOptions(duracion, '50')
    expect(within(modal).getByText('14:00 – 14:50')).toBeInTheDocument()
    // $ 5.000/h por 50 min.
    expect(within(modal).getByText(/^\$\s4\.166,67$/)).toBeInTheDocument()

    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() => expect(bookLesson).toHaveBeenCalledTimes(1))
    // El precio no se manda: lo calcula el backend.
    expect(bookLesson).toHaveBeenCalledWith({
      windowId: 'w-laura',
      date: HOY,
      startTime: '14:00',
      subjectId: 1,
      durationMinutes: 50,
    })
    // Se vuelve a pedir todo: ese horario puede pasar a chocar con las
    // tarjetas de otros docentes.
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('con varias materias hay que elegir una, y el precio es el de esa', async () => {
    fetchAvailability.mockResolvedValue([carla()])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))
    const modal = screen.getByRole('dialog')

    await userEvent.click(within(modal).getByRole('button', { name: '09:00' }))
    expect(within(modal).getByText('Elegí la materia para ver el precio.')).toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: 'Confirmar reserva' })).toBeDisabled()

    await userEvent.click(within(modal).getByRole('button', { name: /^Física.*\/h$/ }))
    // $ 8.000/h por 1 h, y en una grupal lo paga cada uno.
    expect(within(modal).getByText(/^\$\s8\.000$/)).toHaveTextContent('por alumno')
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(bookLesson).toHaveBeenCalledWith(expect.objectContaining({ subjectId: 2 })),
    )
  })

  it('cambiar la hora respeta la duración elegida si entra, y si no la acorta', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    const modal = screen.getByRole('dialog')

    await userEvent.click(within(modal).getByRole('button', { name: '13:00' }))
    await userEvent.selectOptions(within(modal).getByLabelText('¿Cuánto dura?'), '90')
    await userEvent.click(within(modal).getByRole('button', { name: '14:00' }))
    expect(within(modal).getByLabelText('¿Cuánto dura?')).toHaveValue('90')

    await userEvent.click(within(modal).getByRole('button', { name: '16:00' }))
    expect(within(modal).getByLabelText('¿Cuánto dura?')).toHaveValue('60')
  })

  it('avisa que quedó reservada', async () => {
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    await userEvent.click(screen.getByRole('button', { name: '14:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    expect(await screen.findByRole('status')).toHaveTextContent(
      'Reservaste Matemática con Laura Gómez',
    )
  })

  it('en una grupal se puede sumar a una clase armada: materia, hora y duración vienen con ella', async () => {
    fetchAvailability.mockResolvedValue([
      carla({
        free: [{ start: '10:00', end: '11:00' }],
        groups: [{ start: '09:00', end: '09:45', subjectId: 2, subjectName: 'Física', enrolled: 3 }],
      }),
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))

    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Sumate a una clase grupal')).toBeInTheDocument()
    await userEvent.click(
      within(modal).getByRole('button', { name: 'Física, 09:00 a 09:45, 3 de 4 anotados' }),
    )
    expect(within(modal).getByRole('button', { name: /^Física.*\/h$/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(within(modal).queryByLabelText('¿Cuánto dura?')).not.toBeInTheDocument()
    expect(within(modal).getByText(/te sumás a una clase grupal/)).toBeInTheDocument()
    // $ 8.000/h por 45 min.
    expect(within(modal).getByText(/^\$\s6\.000$/)).toHaveTextContent('por alumno')
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))

    await waitFor(() =>
      expect(bookLesson).toHaveBeenCalledWith({
        windowId: 'w-carla',
        date: HOY,
        startTime: '09:00',
        subjectId: 2,
        durationMinutes: 45,
      }),
    )
  })

  it('cambiar de materia suelta la grupal elegida', async () => {
    fetchAvailability.mockResolvedValue([
      carla({
        free: [{ start: '10:00', end: '11:00' }],
        groups: [{ start: '09:00', end: '10:00', subjectId: 2, subjectName: 'Física', enrolled: 1 }],
      }),
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))
    const modal = screen.getByRole('dialog')

    await userEvent.click(within(modal).getByRole('button', { name: /^Física, 09:00/ }))
    await userEvent.click(within(modal).getByRole('button', { name: /^Matemática.*\/h$/ }))

    expect(within(modal).getByRole('button', { name: /^Física, 09:00/ })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(within(modal).getByRole('button', { name: 'Confirmar reserva' })).toBeDisabled()
  })

  it('en una presencial el modal dice la localidad y que la dirección llega al reservar', async () => {
    fetchAvailability.mockResolvedValue([carla()])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))

    const modal = screen.getByRole('dialog')
    expect(within(modal).getByText('Puerto Madero')).toBeInTheDocument()
    expect(
      within(modal).getByText('La dirección exacta te aparece en tu calendario cuando reserves.'),
    ).toBeInTheDocument()
  })

  it('una clase propia bloquea los inicios que pisa y acorta los de antes', async () => {
    fetchMyLessons.mockResolvedValue([
      {
        id: 'mia',
        date: HOY,
        teacherId: 4,
        teacherName: 'Carla Benítez',
        subjectName: 'Física',
        startTime: '14:30',
        endTime: '15:00',
      },
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    const modal = screen.getByRole('dialog')

    expect(within(modal).getByRole('button', { name: '14:30, ya tenés otra clase' })).toBeDisabled()
    expect(within(modal).getByRole('button', { name: '15:00' })).toBeEnabled()

    // De 13:00 hasta su clase de las 14:30: como mucho 1 h 30 min.
    await userEvent.click(within(modal).getByRole('button', { name: '13:00' }))
    const opciones = within(within(modal).getByLabelText('¿Cuánto dura?')).getAllByRole('option')
    expect(opciones.at(-1)).toHaveTextContent('1 h 30 min (hasta las 14:30)')
  })

  it('con un solo horario posible llega elegido', async () => {
    // 13:00 a 13:45: solo entra arrancar 13:00 (a las 13:30 no entran 30 min).
    fetchAvailability.mockResolvedValue([slot({ free: [{ start: '13:00', end: '13:45' }] })])
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
    await userEvent.click(screen.getByRole('button', { name: '14:00' }))
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

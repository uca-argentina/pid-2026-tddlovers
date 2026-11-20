import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import BookingBoard from './BookingBoard.jsx'
import withRouter from '../../routes/withRouter.jsx'
import { toISODate } from '../../utils/calendar.js'
import { dayKeyFromIso } from '../../utils/booking.js'
import { apiClass, apiStudentPack, apiUser, startsBetween } from '../../testing/fixtures.js'

const { bookLesson, fetchAvailability, fetchClass, fetchMyLessons, fetchSubjects, rescheduleLesson } =
  vi.hoisted(() => ({
    bookLesson: vi.fn(),
    fetchAvailability: vi.fn(),
    fetchClass: vi.fn(),
    fetchMyLessons: vi.fn(),
    fetchSubjects: vi.fn(),
    rescheduleLesson: vi.fn(),
  }))

// Los paquetes del alumno: el tablero los pide para ofrecer reservar con
// ellos. Acá nadie tiene paquete.
const fetchMyPacks = vi.hoisted(() => vi.fn(() => Promise.resolve([])))
const fetchNeuronas = vi.hoisted(() => vi.fn(() => Promise.resolve({ balance: 0 })))

// Los docentes favoritos del alumno: el corazón de cada tarjeta y el filtro
// "Solo favoritos". Salvo en sus tests, nadie es favorito.
const { addFavoriteTeacher, fetchFavoriteTeachers, removeFavoriteTeacher } = vi.hoisted(() => ({
  addFavoriteTeacher: vi.fn(),
  fetchFavoriteTeachers: vi.fn(),
  removeFavoriteTeacher: vi.fn(),
}))

// La fábrica reemplaza el módulo ENTERO: lo que no esté acá llega como
// undefined. bookLesson lo usa BookingDialog, no el tablero.
vi.mock('../../api/client.js', () => ({
  addFavoriteTeacher,
  bookLesson,
  fetchAvailability,
  fetchClass,
  fetchFavoriteTeachers,
  fetchMyLessons,
  fetchMyPacks,
  fetchNeuronas,
  fetchSubjects,
  removeFavoriteTeacher,
  rescheduleLesson,
}))

const MATERIAS = [
  { id: 1, name: 'Matemática' },
  { id: 2, name: 'Física' },
]

const alumno = apiUser({
  id: 7,
  email: 'sofia@example.com',
  role: 'student',
  nombre: 'Sofía',
  apellido: 'Ramírez',
})

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
    starts: startsBetween('13:00', '17:00'),
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
    starts: startsBetween('09:00', '11:00'),
    ...overrides,
  })

const RESERVAR_CARLA = 'Reservar con Carla Benítez, 09:00 – 11:00'

// Un paquete del alumno tal como lo manda /api/packs/mine: dos clases de 1 h
// con Carla.
const paquete = (overrides = {}) =>
  apiStudentPack({ teacherId: 4, teacherName: 'Carla Benítez', ...overrides })

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
    bookLesson.mockReset().mockResolvedValue(apiClass({ id: 'nueva' }))
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    fetchMyLessons.mockReset().mockResolvedValue([])
    fetchAvailability.mockReset().mockResolvedValue([slot()])
    fetchFavoriteTeachers.mockReset().mockResolvedValue([])
    addFavoriteTeacher.mockReset().mockResolvedValue(null)
    removeFavoriteTeacher.mockReset().mockResolvedValue(null)
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
        starts: startsBetween('10:00', '11:00'),
        groups: [
          {
            start: '09:00',
            end: '10:00',
            subjectId: 2,
            subjectName: 'Física',
            enrolled: 2,
            maxStudents: 4,
          },
        ],
      }),
    ])
    renderBoard()
    await esperarCarga()

    expect(
      await screen.findByText('Sumate a Física de las 09:00: 2 de 4 anotados.'),
    ).toBeInTheDocument()
  })

  it('muestra lo que manda el backend sin recalcular choques con las clases propias', async () => {
    // El backend ya recortó los inicios con las clases del alumno: el
    // tablero no vuelve a cruzarlas ni avisa superposiciones.
    fetchMyLessons.mockResolvedValue([
      apiClass({ id: 'sl-1', date: HOY, teacherId: 4, startTime: '14:00', endTime: '15:00' }),
    ])
    renderBoard()
    await esperarCarga()

    expect(await screen.findByText('13:00 – 17:00')).toBeInTheDocument()
    expect(screen.queryByText(/Se superpone/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Reservar / })).toBeEnabled()
  })

  it('un día de licencia se ve en gris, no se reserva y no cuenta', async () => {
    fetchAvailability.mockResolvedValue([
      slot({ onVacation: true, starts: [], groups: [] }),
      carla(),
    ])
    renderBoard()
    await esperarCarga()

    expect(await screen.findByText('El docente está de licencia este día.')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Reservar con Laura Gómez, 13:00 – 17:00, de licencia' }),
    ).toBeDisabled()
    expect(screen.getByText('1 clase para reservar')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /1 horario libre$/ })).toBeInTheDocument()
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

  it('filtra por materia: una tarjeta cuya única grupal es de otra materia no pasa', async () => {
    fetchAvailability.mockResolvedValue([
      carla({
        starts: [],
        groups: [
          {
            start: '09:00',
            end: '10:00',
            subjectId: 2,
            subjectName: 'Física',
            enrolled: 1,
            maxStudents: 4,
          },
        ],
      }),
    ])
    renderBoard()
    await esperarCarga()

    await abrirFiltro('Materias')
    await userEvent.click(await screen.findByRole('button', { name: 'Matemática' }))
    expect(screen.queryByText('09:00 – 11:00')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Matemática' }))
    await userEvent.click(screen.getByRole('button', { name: 'Física' }))
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
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

  it('buscar una materia por su nombre la deja elegida', async () => {
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
    const chip = screen.getByLabelText('Quitar la búsqueda')
    expect(chip).toHaveTextContent('gomez')

    await userEvent.click(chip)
    expect(screen.queryByLabelText('Quitar la búsqueda')).not.toBeInTheDocument()
  })

  it('un pedazo de nombre busca docentes y materias, sin elegir una materia', async () => {
    // Bug: "Ana" se resolvía como Análisis y nunca buscaba a la docente Ana.
    fetchSubjects.mockResolvedValue([...MATERIAS, { id: 3, name: 'Análisis' }])
    fetchAvailability.mockResolvedValue([slot({ teacherName: 'Ana Pérez' }), carla()])
    renderBoard('/disponibilidad?q=Ana')
    await esperarCarga()

    expect(await screen.findByText('13:00 – 17:00')).toBeInTheDocument()
    expect(screen.queryByText('09:00 – 11:00')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Quitar la búsqueda')).toHaveTextContent('Ana')
  })

  it('el texto libre también encuentra por materia', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    renderBoard('/disponibilidad?q=fisi')
    await esperarCarga()

    expect(await screen.findByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('buscar un docente que no existe no deja nada', async () => {
    renderBoard('/disponibilidad?q=inexistente')
    await esperarCarga()

    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
  })

  it('"Solo favoritos" deja solo los horarios de docentes favoritos', async () => {
    fetchAvailability.mockResolvedValue([slot(), carla()])
    fetchFavoriteTeachers.mockResolvedValue([
      { id: 4, nombre: 'Carla', apellido: 'Benítez', subjects: [] },
    ])
    renderBoard()
    await esperarCarga()
    expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Solo favoritos' }))

    expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
    expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sacar de favoritos a Carla Benítez' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('el corazón de la tarjeta agrega y saca al docente de favoritos', async () => {
    renderBoard()
    await esperarCarga()

    await userEvent.click(screen.getByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }))
    expect(addFavoriteTeacher).toHaveBeenCalledWith(2)
    const corazon = await screen.findByRole('button', { name: 'Sacar de favoritos a Laura Gómez' })
    expect(corazon).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(corazon)
    expect(removeFavoriteTeacher).toHaveBeenCalledWith(2)
    expect(
      await screen.findByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }),
    ).toHaveAttribute('aria-pressed', 'false')
  })

  it('si no se puede marcar el favorito lo avisa y el corazón queda como estaba', async () => {
    addFavoriteTeacher.mockRejectedValue(new Error('Ese docente no existe o no está disponible por ahora.'))
    renderBoard()
    await esperarCarga()

    await userEvent.click(screen.getByRole('button', { name: 'Agregar a favoritos a Laura Gómez' }))

    expect(
      await screen.findByText('Ese docente no existe o no está disponible por ahora.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Agregar a favoritos a Laura Gómez' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('un docente no ve corazones ni el filtro de favoritos', async () => {
    renderBoard('/disponibilidad', { user: apiUser({ role: 'teacher' }) })
    await esperarCarga()

    expect(screen.queryByRole('button', { name: 'Solo favoritos' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /favoritos a Laura/ })).not.toBeInTheDocument()
    expect(fetchFavoriteTeachers).not.toHaveBeenCalled()
  })

  describe('en el teléfono', () => {
    it('tiene título, buscador, chips rápidos y la tira de semana', async () => {
      renderBoard('/disponibilidad', { mobile: true })
      await esperarCarga()

      expect(screen.getByRole('heading', { name: 'Reservar' })).toBeInTheDocument()
      expect(screen.getByLabelText('Buscar docentes o materias')).toBeInTheDocument()
      expect(screen.getByRole('group', { name: 'Días de la semana' })).toBeInTheDocument()
      expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()
    })

    it('un chip rápido filtra sin abrir la hoja', async () => {
      fetchAvailability.mockResolvedValue([slot(), carla()])
      renderBoard('/disponibilidad', { mobile: true })
      await esperarCarga()

      const rapidos = screen.getByRole('group', { name: 'Filtros rápidos' })
      await userEvent.click(within(rapidos).getByRole('button', { name: 'Presencial' }))

      expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()
      expect(screen.getByText('09:00 – 11:00')).toBeInTheDocument()
      expect(within(rapidos).getByRole('button', { name: 'Filtros, 1 activos' })).toBeInTheDocument()
    })

    it('"Filtros" abre la hoja con todos los filtros, y "Limpiar" los saca', async () => {
      renderBoard('/disponibilidad', { mobile: true })
      await esperarCarga()

      await userEvent.click(screen.getByRole('button', { name: 'Filtros' }))
      const hoja = screen.getByRole('dialog', { name: 'Filtros' })
      const otroDia = DIA_HOY === 'lunes' ? 'Martes' : 'Lunes'
      await userEvent.click(within(hoja).getByRole('button', { name: otroDia }))
      expect(screen.queryByText('13:00 – 17:00')).not.toBeInTheDocument()

      await userEvent.click(within(hoja).getByRole('button', { name: 'Limpiar' }))
      await userEvent.click(within(hoja).getByRole('button', { name: 'Listo' }))

      expect(screen.queryByRole('dialog', { name: 'Filtros' })).not.toBeInTheDocument()
      expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()
    })
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

  describe('canjear neuronas', () => {
    const abrir = async (saldo) => {
      fetchNeuronas.mockResolvedValue({ balance: saldo })
      fetchAvailability.mockResolvedValue([slot({ teacherAcceptsRewards: true })])
      renderBoard()
      await esperarCarga()
      await waitFor(() => expect(fetchNeuronas).toHaveBeenCalled())
      await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
      const modal = screen.getByRole('dialog')
      await userEvent.click(within(modal).getByRole('button', { name: '14:00' }))
      return modal
    }

    afterEach(() => {
      fetchNeuronas.mockReset().mockResolvedValue({ balance: 0 })
    })

    it('manda el canje y muestra que la clase queda cubierta', async () => {
      const modal = await abrir(1000)

      await userEvent.click(within(modal).getByRole('button', { name: /1 h gratis/ }))
      expect(within(modal).getByText('Cubierta con neuronas')).toBeInTheDocument()

      await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))
      await waitFor(() =>
        expect(bookLesson).toHaveBeenCalledWith(expect.objectContaining({ rewardType: 'free_60' })),
      )
    })

    it('el descuento muestra lo que queda por pagar', async () => {
      const modal = await abrir(1000)

      await userEvent.click(within(modal).getByRole('button', { name: /20% de descuento/ }))
      // $ 5.000/h por 1 h, menos el 20%.
      expect(within(modal).getByText(/\$\s4\.000/)).toBeInTheDocument()
    })

    it('deshabilita lo que no alcanza', async () => {
      const modal = await abrir(600)

      expect(within(modal).getByRole('button', { name: /1 h gratis/ })).toBeDisabled()
      expect(within(modal).getByRole('button', { name: /30 min gratis/ })).toBeEnabled()
    })

    it('si la clase se acorta, deja de aplicar un canje que ya no entra', async () => {
      const modal = await abrir(1000)

      await userEvent.click(within(modal).getByRole('button', { name: /1 h gratis/ }))
      fireEvent.change(within(modal).getByLabelText('¿Cuánto dura?'), { target: { value: '30' } })

      expect(within(modal).queryByText('Cubierta con neuronas')).not.toBeInTheDocument()
      await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))
      await waitFor(() => expect(bookLesson).toHaveBeenCalled())
      expect(bookLesson.mock.calls.at(-1)[0].rewardType).toBeUndefined()
    })

    it('sin canjes activos no se ofrece', async () => {
      fetchNeuronas.mockResolvedValue({ balance: 5000 })
      renderBoard()
      await esperarCarga()
      await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
      const modal = screen.getByRole('dialog')
      await userEvent.click(within(modal).getByRole('button', { name: '14:00' }))

      expect(within(modal).queryByText('Usar neuronas')).not.toBeInTheDocument()
    })
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
    expect(duracion).toHaveAttribute('min', '30')
    expect(duracion).toHaveAttribute('max', '180')
    expect(duracion).toHaveAttribute('step', '5')
    expect(duracion).toHaveAttribute('aria-valuetext', '1 h · 14:00 – 15:00')

    fireEvent.change(duracion, { target: { value: '50' } })
    expect(duracion).toHaveAttribute('aria-valuetext', '50 min · 14:00 – 14:50')
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
    fireEvent.change(within(modal).getByLabelText('¿Cuánto dura?'), { target: { value: '90' } })
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
        starts: startsBetween('10:00', '11:00'),
        groups: [
          {
            start: '09:00',
            end: '09:45',
            subjectId: 2,
            subjectName: 'Física',
            enrolled: 3,
            maxStudents: 4,
          },
        ],
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
        starts: startsBetween('10:00', '11:00'),
        groups: [
          {
            start: '09:00',
            end: '10:00',
            subjectId: 2,
            subjectName: 'Física',
            enrolled: 1,
            maxStudents: 4,
          },
        ],
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

  it('arma inicios y duraciones con lo que manda el backend', async () => {
    // El backend ya sacó 13:30–14:30 (le chocan con una clase propia de las
    // 14:30) y cortó 13:00 en 1 h 30 min.
    fetchAvailability.mockResolvedValue([
      slot({
        starts: [
          { start: '13:00', maxMinutes: 90 },
          { start: '15:00', maxMinutes: 120 },
        ],
      }),
    ])
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    const modal = screen.getByRole('dialog')

    expect(within(modal).queryByRole('button', { name: '14:30' })).not.toBeInTheDocument()
    expect(within(modal).getByRole('button', { name: '15:00' })).toBeEnabled()

    await userEvent.click(within(modal).getByRole('button', { name: '13:00' }))
    const duracion = within(modal).getByLabelText('¿Cuánto dura?')
    expect(duracion).toHaveAttribute('min', '30')
    expect(duracion).toHaveAttribute('max', '90')
    expect(duracion).toHaveAttribute('step', '5')
  })

  it('con un solo horario posible llega elegido', async () => {
    // 13:00 a 13:45: solo entra arrancar 13:00 (a las 13:30 no entran 30 min).
    fetchAvailability.mockResolvedValue([slot({ starts: startsBetween('13:00', '13:45') })])
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

  it('mientras se envía la reserva el modal no se cierra, y al volver avisa y recarga', async () => {
    let resolver
    bookLesson.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve
      }),
    )
    renderBoard()
    await esperarCarga()
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))
    await userEvent.click(screen.getByRole('button', { name: '14:00' }))
    await userEvent.click(screen.getByRole('button', { name: 'Confirmar reserva' }))

    await userEvent.keyboard('{Escape}')
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeDisabled()

    resolver(apiClass({ id: 'nueva' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Reservaste Matemática')
    await waitFor(() => expect(fetchAvailability).toHaveBeenCalledTimes(2))
  })

  it('con un paquete ya reservado entero explica que la clase se paga aparte', async () => {
    fetchMyPacks.mockResolvedValue([paquete({ teacherId: 2, available: 0, usable: false })])
    renderBoard()
    await esperarCarga()
    await waitFor(() => expect(fetchMyPacks).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: /^Reservar / }))

    expect(
      within(screen.getByRole('dialog')).getByText(
        'Ya reservaste todas las clases de tu paquete con este docente: esta clase se paga aparte.',
      ),
    ).toBeInTheDocument()
    fetchMyPacks.mockReset().mockResolvedValue([])
  })

  it('un canje elegido deja de aplicarse al pasar a una materia sin cargo', async () => {
    fetchNeuronas.mockResolvedValue({ balance: 1000 })
    fetchAvailability.mockResolvedValue([
      carla({
        teacherAcceptsRewards: true,
        subjects: [
          { id: 2, name: 'Física', hourlyRateCents: 0 },
          { id: 1, name: 'Matemática', hourlyRateCents: 700000 },
        ],
      }),
    ])
    renderBoard()
    await esperarCarga()
    await waitFor(() => expect(fetchNeuronas).toHaveBeenCalled())
    await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))
    const modal = screen.getByRole('dialog')

    await userEvent.click(within(modal).getByRole('button', { name: '09:00' }))
    await userEvent.click(within(modal).getByRole('button', { name: /^Matemática/ }))
    await userEvent.click(within(modal).getByRole('button', { name: /30 min gratis/ }))
    await userEvent.click(within(modal).getByRole('button', { name: /^Física/ }))

    expect(within(modal).queryByText('Usar neuronas')).not.toBeInTheDocument()
    expect(modal.querySelector('.booking-dialog-price')).toHaveTextContent(/^Sin cargo$/)
    await userEvent.click(within(modal).getByRole('button', { name: 'Confirmar reserva' }))
    await waitFor(() => expect(bookLesson).toHaveBeenCalled())
    expect(bookLesson.mock.calls[0][0].rewardType).toBeUndefined()
    fetchNeuronas.mockReset().mockResolvedValue({ balance: 0 })
  })

  it('si el usuario llega después de cargar el mes, vuelve a pedirlo con sus clases', async () => {
    // Los horarios dependen del alumno de la sesión (el backend los recorta
    // con sus clases), así que se vuelven a pedir.
    const tree = (user) => (
      <MemoryRouter initialEntries={['/disponibilidad']}>
        <Routes>
          <Route path="/disponibilidad" element={<BoardConRouter user={user} />} />
        </Routes>
      </MemoryRouter>
    )
    const { rerender } = render(tree(null))
    await esperarCarga()
    expect(fetchMyLessons).not.toHaveBeenCalled()
    expect(fetchAvailability).toHaveBeenCalledTimes(1)

    rerender(tree(alumno))

    await waitFor(() => expect(fetchMyLessons).toHaveBeenCalledTimes(1))
    expect(fetchAvailability).toHaveBeenCalledTimes(2)
  })

  it('sin usuario no pide las clases propias', async () => {
    renderBoard('/disponibilidad', { user: null })
    await esperarCarga()

    expect(fetchMyLessons).not.toHaveBeenCalled()
    expect(screen.getByText('13:00 – 17:00')).toBeInTheDocument()
  })

  describe('reprogramar', () => {
    // Una clase de Física con Carla, hoy de 9 a 10, ya pagada.
    const vieja = apiClass({
      id: 'c9',
      date: HOY,
      startTime: '09:00',
      endTime: '10:00',
      teacherId: 4,
      teacherName: 'Carla Benítez',
      subjectId: 2,
      subjectName: 'Física',
      status: 'confirmada',
      paidAt: '2099-09-01T12:00:00.000Z',
    })

    beforeEach(() => {
      fetchClass.mockReset().mockResolvedValue(vieja)
      rescheduleLesson.mockReset().mockResolvedValue(apiClass({ id: 'nueva', teacherId: 4 }))
      // Con excludeClassId el backend manda solo a Carla, recortada a Física
      // (la materia de la clase vieja) y sin contar la vieja como ocupada.
      fetchAvailability.mockImplementation(({ excludeClassId }) =>
        Promise.resolve(
          excludeClassId
            ? [carla({ subjects: [{ id: 2, name: 'Física', hourlyRateCents: 800000 }] })]
            : [slot(), carla()],
        ),
      )
      fetchMyLessons.mockResolvedValue([vieja])
    })

    it('muestra lo que manda el backend para reprogramar', async () => {
      renderBoard('/disponibilidad?reprogramar=c9')
      await esperarCarga()

      expect(await screen.findByText(/Reprogramando tu clase de/)).toHaveTextContent('Física')
      expect(fetchClass).toHaveBeenCalledWith('c9')
      expect(screen.getByRole('button', { name: RESERVAR_CARLA })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Reservar con Laura Gómez/ })).not.toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: RESERVAR_CARLA }))
      const modal = screen.getByRole('dialog', { name: 'Reprogramar clase' })
      expect(within(modal).queryByText('Matemática')).not.toBeInTheDocument()
      expect(within(modal).getByRole('button', { name: '09:00' })).toBeEnabled()
    })

    it('pide el cambio en vez de una reserva nueva, y lo avisa', async () => {
      renderBoard('/disponibilidad?reprogramar=c9')
      await esperarCarga()
      await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))
      const modal = screen.getByRole('dialog')

      await userEvent.click(within(modal).getByRole('button', { name: '10:00' }))
      await userEvent.click(within(modal).getByRole('button', { name: 'Pedir nuevo horario' }))

      expect(rescheduleLesson).toHaveBeenCalledWith(
        'c9',
        expect.objectContaining({ windowId: 'w-carla', startTime: '10:00' }),
      )
      expect(bookLesson).not.toHaveBeenCalled()
      expect(await screen.findByText(/Pediste el nuevo horario de Física/)).toBeInTheDocument()
    })

    it('pide la disponibilidad sin contar la clase vieja como ocupada', async () => {
      renderBoard('/disponibilidad?reprogramar=c9')
      await esperarCarga()

      expect(fetchAvailability).toHaveBeenCalledWith(
        expect.objectContaining({ excludeClassId: 'c9' }),
      )
    })

    it('las clases del paquete que usaba la vieja vuelven a estar para la nueva', async () => {
      // Paquete de 2: una ya realizada y la otra es la que se reprograma.
      fetchClass.mockResolvedValue({ ...vieja, studentPackId: 'p1', packTokens: 1, priceCents: 0 })
      // El backend lo manda no usable: sin contar la vieja no le queda ninguna.
      fetchMyPacks.mockResolvedValue([paquete({ remaining: 1, available: 0, usable: false })])
      renderBoard('/disponibilidad?reprogramar=c9')
      await esperarCarga()
      await screen.findByText(/Reprogramando tu clase de/)
      await waitFor(() => expect(fetchMyPacks).toHaveBeenCalled())
      await userEvent.click(await screen.findByRole('button', { name: RESERVAR_CARLA }))
      const modal = screen.getByRole('dialog')

      await userEvent.click(within(modal).getByRole('button', { name: '10:00' }))
      expect(within(modal).getByText('Incluida en tu paquete')).toBeInTheDocument()
      await userEvent.click(within(modal).getByRole('button', { name: 'Pedir nuevo horario' }))

      expect(rescheduleLesson).toHaveBeenCalledWith(
        'c9',
        expect.objectContaining({ packId: 'p1', packTokens: 1 }),
      )
      fetchMyPacks.mockReset().mockResolvedValue([])
    })

    it('se puede dejar de reprogramar y volver a ver todo', async () => {
      renderBoard('/disponibilidad?reprogramar=c9')
      await esperarCarga()
      await screen.findByText(/Reprogramando tu clase de/)

      await userEvent.click(screen.getByRole('button', { name: 'Dejar de reprogramar' }))

      expect(screen.queryByText(/Reprogramando tu clase de/)).not.toBeInTheDocument()
      expect(await screen.findByRole('button', { name: /Reservar con Laura Gómez/ })).toBeInTheDocument()
    })
  })
})

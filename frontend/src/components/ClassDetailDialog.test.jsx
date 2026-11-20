import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ClassDetailDialog from './ClassDetailDialog.jsx'
import { apiBooking } from '../testing/fixtures.js'

const { acceptBooking, fetchClassMaterial, markAttendance } = vi.hoisted(() => ({
  acceptBooking: vi.fn(),
  fetchClassMaterial: vi.fn(),
  markAttendance: vi.fn(),
}))

vi.mock('../api/client.js', () => ({
  acceptBooking,
  acceptClass: vi.fn(),
  cancelClass: vi.fn(),
  cancelBooking: vi.fn(),
  classFileUrl: () => '',
  deleteClassFile: vi.fn(),
  fetchClassMaterial,
  markAttendance,
  payBooking: vi.fn(),
  saveClassSummary: vi.fn(),
  uploadClassFiles: vi.fn(),
}))

const DESPUES = { iso: '2099-09-14', time: '15:00' }
const ANTES = { iso: '2099-09-10', time: '10:00' }

// Una grupal de dos: una reserva por alumno, misma clase.
const clase = { teacherId: 't1', date: '2099-09-14', startTime: '13:00', maxStudents: 3 }
const sofia = apiBooking({
  ...clase,
  id: 'r1',
  status: 'confirmada',
  paidAt: '2099-09-01T12:00:00.000Z',
  studentName: 'Sofía Ramírez',
})
const ana = apiBooking({ ...clase, id: 'r2', status: 'aceptada', studentName: 'Ana Pérez' })

function renderDialog(props) {
  return render(
    <MemoryRouter>
      <ClassDetailDialog bookings={[sofia, ana]} cls={sofia} viewRole="teacher" {...props} />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  fetchClassMaterial.mockResolvedValue({ summary: '', updatedAt: null, files: [] })
})

describe('ClassDetailDialog', () => {
  it('cuando la clase pasó, en una grupal solo queda tomar lista, con quién pagó', async () => {
    markAttendance.mockResolvedValue({ ...ana, status: 'realizada' })
    const onChange = vi.fn()

    renderDialog({ now: DESPUES, onChange })

    const dialogo = screen.getByRole('dialog', { name: 'Matemática' })
    expect(within(dialogo).getByText('Grupal · 2 de 3')).toBeInTheDocument()
    // Los alumnos no están en el detalle ni hay "Ver alumnos": ya pasó.
    expect(within(dialogo).queryByText('Ana Pérez')).not.toBeInTheDocument()
    expect(within(dialogo).queryByRole('button', { name: 'Ver alumnos' })).not.toBeInTheDocument()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Tomar asistencia' }))
    const asistencia = screen.getByRole('dialog', { name: 'Tomar asistencia' })
    expect(within(asistencia).getByText('Pagó')).toBeInTheDocument()
    expect(within(asistencia).getByText('Sin pagar')).toBeInTheDocument()
    await userEvent.click(
      within(within(asistencia).getByRole('group', { name: 'Asistencia de Ana Pérez' })).getByRole(
        'button',
        { name: 'Presente' },
      ),
    )

    expect(markAttendance).toHaveBeenCalledWith('r2', true)
    expect(onChange).toHaveBeenCalledWith({ ...ana, status: 'realizada' })
    expect(await within(dialogo).findByLabelText('Resumen de la clase')).toBeInTheDocument()
  })

  it('antes de la clase, en "Ver alumnos" se acepta a uno sin aceptar al otro', async () => {
    const pendientes = [
      { ...sofia, status: 'pendiente', paidAt: null },
      { ...ana, status: 'pendiente' },
    ]
    acceptBooking.mockResolvedValue({ ...pendientes[1], status: 'aceptada' })
    const onChange = vi.fn()

    renderDialog({ cls: pendientes[0], bookings: pendientes, now: ANTES, onChange })

    const dialogo = screen.getByRole('dialog', { name: 'Matemática' })
    expect(within(dialogo).getByRole('button', { name: 'Aceptar a los 2' })).toBeInTheDocument()
    expect(within(dialogo).queryByText('Ana Pérez')).not.toBeInTheDocument()

    await userEvent.click(within(dialogo).getByRole('button', { name: 'Ver alumnos' }))
    const alumnos = screen.getByRole('dialog', { name: 'Alumnos' })
    expect(within(alumnos).getAllByText('Sin pagar')).toHaveLength(2)
    const [deAna] = within(alumnos).getAllByRole('listitem')
    await userEvent.click(within(deAna).getByRole('button', { name: 'Aceptar' }))

    expect(acceptBooking).toHaveBeenCalledWith('r2')
    expect(onChange).toHaveBeenCalledWith({ ...pendientes[1], status: 'aceptada' })
  })

  it('antes de la clase no hay lista ni material para cargar', () => {
    renderDialog({ now: ANTES })

    expect(screen.queryByRole('button', { name: 'Tomar asistencia' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ver alumnos' })).toBeInTheDocument()
    expect(screen.getByText(/cuando termine la clase/)).toBeInTheDocument()
    expect(fetchClassMaterial).not.toHaveBeenCalled()
  })

  it('el alumno ve su estado y el material, sin los otros de la clase', async () => {
    renderDialog({ viewRole: 'student', now: DESPUES })

    expect(screen.getByText('Estado')).toBeInTheDocument()
    expect(screen.getByText('Con Laura Gómez', { exact: false })).toBeInTheDocument()
    expect(screen.queryByText(/Ana Pérez/)).not.toBeInTheDocument()
    expect(
      await screen.findByText('El docente todavía no cargó material de esta clase.'),
    ).toBeInTheDocument()
  })

  it('una cancelada no tiene sección de material', () => {
    renderDialog({ cls: apiBooking({ status: 'cancelada' }), bookings: [], now: DESPUES })

    expect(screen.queryByText('Material de la clase')).not.toBeInTheDocument()
  })
})

describe('ClassDetailDialog — dirección', () => {
  const presencial = {
    modality: 'in_person',
    meetingUrl: null,
    locality: 'Palermo',
  }

  it('sin pagar, el alumno ve la localidad y cuándo va a ver la dirección', () => {
    const cls = apiBooking({ ...presencial, address: null, status: 'aceptada' })
    render(
      <MemoryRouter>
        <ClassDetailDialog cls={cls} bookings={[cls]} viewRole="student" now={ANTES} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Palermo')).toBeInTheDocument()
    expect(screen.getByText(/La dirección exacta aparece cuando pagues la clase/)).toBeInTheDocument()
  })

  it('paga, ve la dirección completa', () => {
    const cls = apiBooking({
      ...presencial,
      address: 'Honduras 4800 · CP 1414 · Palermo, CABA',
      status: 'confirmada',
      paidAt: '2099-09-01T12:00:00.000Z',
    })
    render(
      <MemoryRouter>
        <ClassDetailDialog cls={cls} bookings={[cls]} viewRole="student" now={ANTES} />
      </MemoryRouter>,
    )

    expect(screen.getByText('Honduras 4800 · CP 1414 · Palermo, CABA')).toBeInTheDocument()
    expect(screen.queryByText(/aparece cuando pagues/)).not.toBeInTheDocument()
  })

  it('en una grupal el docente ve el rango de precios, sin el paquete de un alumno', () => {
    const conPaquete = { ...ana, priceCents: 0, packTokens: 1 }
    renderDialog({ bookings: [sofia, conPaquete], cls: sofia, now: ANTES })

    const dialogo = screen.getByRole('dialog', { name: 'Matemática' })
    expect(within(dialogo).getByText(/^Sin cargo – \$\s5\.000 por alumno$/)).toBeInTheDocument()
    expect(within(dialogo).queryByText(/del paquete/)).not.toBeInTheDocument()
  })

  it('si todos pagan lo mismo, un solo precio por alumno', () => {
    renderDialog({ now: ANTES })
    expect(screen.getByText(/^\$\s5\.000 por alumno$/)).toBeInTheDocument()
  })

  it('el alumno de una grupal ve su paquete', () => {
    const suya = { ...ana, priceCents: 0, packTokens: 1 }
    renderDialog({ bookings: [suya], cls: suya, viewRole: 'student', now: ANTES })
    expect(screen.getByRole('dialog', { name: 'Matemática' })).toHaveTextContent('1 clase del paquete')
  })
})

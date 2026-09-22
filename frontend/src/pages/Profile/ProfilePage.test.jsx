import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import ProfilePage from './ProfilePage.jsx'

const { fetchSubjects, updateProfile } = vi.hoisted(() => ({
  fetchSubjects: vi.fn(),
  updateProfile: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({ fetchSubjects, updateProfile }))

const MATERIAS = [
  { id: 1, name: 'Matemática' },
  { id: 2, name: 'Física' },
  { id: 3, name: 'Álgebra' },
]

const user = {
  id: 1,
  nombre: 'Agustín',
  apellido: 'Klos',
  email: 'agustin@example.com',
  telefono: '+54 11 5555-5555',
  role: 'teacher',
  subjectIds: [1, 3],
}

function renderProfile(props) {
  return render(
    <MemoryRouter>
      <ProfilePage user={user} viewRole="student" {...props} />
    </MemoryRouter>,
  )
}

// Las materias llegan por promesa: si el test no la espera, el setState cae
// afuera y React avisa con el warning de act(). Esperar a que se vaya el
// cartel de "Cargando..." sirve igual haya materias, no haya, o falle — y
// como alumno directamente no hay promesa, así que es un no-op inofensivo.
function esperarMaterias() {
  return waitFor(() => expect(screen.queryByText('Cargando materias...')).not.toBeInTheDocument())
}

function telefonoInput() {
  return screen.getByLabelText('Teléfono (opcional)')
}

function botonGuardar() {
  return screen.getByRole('button', { name: 'Guardar cambios' })
}

describe('ProfilePage', () => {
  beforeEach(() => {
    fetchSubjects.mockReset().mockResolvedValue(MATERIAS)
    updateProfile.mockReset().mockImplementation((payload) => Promise.resolve(payload))
  })

  it('muestra los datos del usuario', async () => {
    renderProfile()
    await esperarMaterias()
    expect(screen.getByText('Agustín Klos')).toBeInTheDocument()
    expect(screen.getByText('agustin@example.com')).toBeInTheDocument()
    expect(telefonoInput()).toHaveValue('+54 11 5555-5555')
  })

  it('el teléfono es lo único editable', async () => {
    renderProfile()
    await esperarMaterias()
    // Email, nombre y apellido son texto, no campos.
    expect(screen.queryByLabelText('Email')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Nombre')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Apellido')).not.toBeInTheDocument()
    expect(telefonoInput()).toBeEnabled()
  })

  it('el teléfono puede venir vacío', async () => {
    renderProfile({ user: { ...user, telefono: '' } })
    await esperarMaterias()
    expect(telefonoInput()).toHaveValue('')
  })

  it('muestra el rol que se está mirando', async () => {
    // Hay que desmontar entre render y render: cleanup() corre en afterEach,
    // así que si no, quedan las dos pantallas montadas a la vez.
    const docente = renderProfile({ viewRole: 'teacher' })
    await esperarMaterias()
    expect(screen.getByText('Docente')).toBeInTheDocument()
    docente.unmount()

    renderProfile({ viewRole: 'student' })
    await esperarMaterias()
    expect(screen.getAllByText('Alumno').length).toBeGreaterThan(0)
  })

  it('solo el docente ve la sección de materias', async () => {
    const docente = renderProfile({ viewRole: 'teacher' })
    expect(await screen.findByText('Materias que das')).toBeInTheDocument()
    await esperarMaterias()
    docente.unmount()

    renderProfile({ viewRole: 'student' })
    await esperarMaterias()
    expect(screen.queryByText('Materias que das')).not.toBeInTheDocument()
    expect(screen.queryByText('Materias que te interesan')).not.toBeInTheDocument()
  })

  it('lista las materias que da y ofrece el resto para agregar', async () => {
    renderProfile({ viewRole: 'teacher' })
    await screen.findByText('Matemática')

    expect(screen.getByLabelText('Dejar de dar Matemática')).toBeInTheDocument()
    expect(screen.getByLabelText('Dejar de dar Álgebra')).toBeInTheDocument()
    // La 2 no está entre las subjectIds del usuario: aparece solo como
    // candidata a agregar, así que hay que preguntar por el control y no por
    // el texto (el texto está en las dos listas).
    expect(screen.queryByLabelText('Dejar de dar Física')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Agregar Física')).toBeInTheDocument()
  })

  it('avisa cuando el docente no eligió materias', async () => {
    renderProfile({ viewRole: 'teacher', user: { ...user, subjectIds: [] } })
    expect(await screen.findByText('Todavía no elegiste materias.')).toBeInTheDocument()
  })

  it('como alumno no hay sección de materias', async () => {
    renderProfile({ viewRole: 'student' })
    await esperarMaterias()

    expect(screen.queryByText('Matemática')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Disponibilidad de/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Dejar de dar/)).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Agregar/)).not.toBeInTheDocument()
    // Sin sección no hay catálogo que traer.
    expect(fetchSubjects).not.toHaveBeenCalled()
  })

  it('pasar de alumno a docente trae el catálogo que no se pidió', async () => {
    // El interruptor de rol cambia la prop SIN desmontar la pantalla, así que
    // la carga que nos ahorramos al montar hay que dispararla acá.
    const { rerender } = render(
      <MemoryRouter>
        <ProfilePage user={user} viewRole="student" />
      </MemoryRouter>,
    )
    await esperarMaterias()
    expect(fetchSubjects).not.toHaveBeenCalled()

    rerender(
      <MemoryRouter>
        <ProfilePage user={user} viewRole="teacher" />
      </MemoryRouter>,
    )
    expect(await screen.findByLabelText('Dejar de dar Matemática')).toBeInTheDocument()
  })

  it('como docente cada materia linkea a su disponibilidad', async () => {
    renderProfile({ viewRole: 'teacher' })
    await screen.findByText('Matemática')

    // El nombre accesible incluye la materia: con solo "Disponibilidad" no
    // se distinguirían entre sí ni del ícono de la barra.
    expect(screen.getByRole('link', { name: 'Disponibilidad de Matemática' })).toHaveAttribute(
      'href',
      '/disponibilidad/1',
    )
    expect(screen.getByRole('link', { name: 'Disponibilidad de Álgebra' })).toHaveAttribute(
      'href',
      '/disponibilidad/3',
    )
  })

  it('como docente se agregan y se quitan materias', async () => {
    renderProfile({ viewRole: 'teacher' })
    await screen.findByText('Matemática')

    // Física no la da: aparece solo como candidata a agregar.
    await userEvent.click(screen.getByLabelText('Agregar Física'))
    expect(screen.getByLabelText('Dejar de dar Física')).toBeInTheDocument()
    expect(screen.queryByLabelText('Agregar Física')).not.toBeInTheDocument()

    await userEvent.click(screen.getByLabelText('Dejar de dar Matemática'))
    expect(screen.getByLabelText('Agregar Matemática')).toBeInTheDocument()
  })

  it('guardar arranca apagado y se prende al cambiar algo', async () => {
    renderProfile()
    await esperarMaterias()
    expect(botonGuardar()).toBeDisabled()

    await userEvent.type(telefonoInput(), '9')
    expect(botonGuardar()).toBeEnabled()
  })

  it('cancelar descarta los cambios', async () => {
    renderProfile()
    await esperarMaterias()
    await userEvent.clear(telefonoInput())
    await userEvent.type(telefonoInput(), '+54 9 11 1234-5678')
    expect(botonGuardar()).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(telefonoInput()).toHaveValue('+54 11 5555-5555')
    expect(botonGuardar()).toBeDisabled()
  })

  it('un teléfono inválido no deja guardar', async () => {
    renderProfile()
    await esperarMaterias()
    await userEvent.clear(telefonoInput())
    await userEvent.type(telefonoInput(), 'abc')
    await userEvent.tab()

    expect(await screen.findByText('Ingresá un teléfono válido.')).toBeInTheDocument()
    expect(botonGuardar()).toBeDisabled()
  })

  it('guarda teléfono y materias en una sola llamada', async () => {
    const onUserChange = vi.fn()
    renderProfile({ viewRole: 'teacher', onUserChange })
    await screen.findByText('Matemática')

    await userEvent.clear(telefonoInput())
    await userEvent.type(telefonoInput(), '+54 9 11 1234-5678')
    await userEvent.click(screen.getByLabelText('Agregar Física'))
    await userEvent.click(botonGuardar())

    await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1))
    expect(updateProfile).toHaveBeenCalledWith({
      telefono: '+54 9 11 1234-5678',
      subjectIds: [1, 3, 2],
    })
    expect(onUserChange).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'agustin@example.com',
        telefono: '+54 9 11 1234-5678',
        subjectIds: [1, 3, 2],
      }),
    )
    expect(await screen.findByText('Listo, guardamos tus cambios.')).toBeInTheDocument()
  })

  it('avisa si falla el guardado', async () => {
    updateProfile.mockRejectedValue(new Error('Se cayó todo.'))
    renderProfile()
    await esperarMaterias()

    await userEvent.type(telefonoInput(), '9')
    await userEvent.click(botonGuardar())

    expect(await screen.findByRole('alert')).toHaveTextContent('Se cayó todo.')
  })

  it('avisa si falla la carga de materias', async () => {
    fetchSubjects.mockRejectedValue(new Error('No hay materias.'))
    renderProfile({ viewRole: 'teacher' })
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay materias.')
  })

  it('avisa cuando el rol que se mira no es el de la cuenta', async () => {
    // El interruptor de rol es un andamio: sin este aviso parecería un error
    // de datos.
    const desalineado = renderProfile({ user: { ...user, role: 'student' }, viewRole: 'teacher' })
    await esperarMaterias()
    expect(screen.getByText(/pero tu cuenta es de alumno/)).toBeInTheDocument()
    desalineado.unmount()

    renderProfile({ user: { ...user, role: 'teacher' }, viewRole: 'teacher' })
    await esperarMaterias()
    expect(screen.queryByText(/pero tu cuenta/)).not.toBeInTheDocument()
  })

  it('tiene un botón para cerrar sesión que lleva al login', async () => {
    const onLogout = vi.fn()
    renderProfile({ onLogout })
    await esperarMaterias()

    const salir = screen.getByRole('link', { name: 'Cerrar sesión' })
    expect(salir).toHaveAttribute('href', '/ingresar')

    await userEvent.click(salir)
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('el docente también puede cerrar sesión', async () => {
    renderProfile({ viewRole: 'teacher' })
    await esperarMaterias()
    expect(screen.getByRole('link', { name: 'Cerrar sesión' })).toBeInTheDocument()
  })

  it('sin usuario manda al login en vez de explotar', () => {
    renderProfile({ user: null })
    expect(screen.getByText('Iniciá sesión para ver tu perfil.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Ir al login' })).toHaveAttribute('href', '/ingresar')
    // Sin usuario no hay nada que editar: no gastamos la llamada.
    expect(fetchSubjects).not.toHaveBeenCalled()
  })
})

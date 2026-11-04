import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { apiHomework, apiSubmission } from '../../testing/fixtures.js'
import HomeworkPage from './HomeworkPage.jsx'

const api = vi.hoisted(() => ({
  createHomework: vi.fn(),
  fetchHomeworkMessages: vi.fn(),
  fetchHomeworks: vi.fn(),
  fetchHomeworkTargets: vi.fn(),
  saveHomeworkFeedback: vi.fn(),
  sendHomeworkMessage: vi.fn(),
  submitHomework: vi.fn(),
}))

vi.mock('../../api/client.js', () => api)

const NOW = { iso: '2099-09-14', time: '12:00' }
const ENTREGADA = '2099-09-14T15:00:00.000Z'

function renderPage(viewRole = 'student') {
  return render(
    <MemoryRouter>
      <HomeworkPage viewRole={viewRole} now={NOW} />
    </MemoryRouter>,
  )
}

const abrirTarea = async (nombre = /TP 1/) =>
  userEvent.click(await screen.findByRole('button', { name: nombre }))

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset())
  api.fetchHomeworkMessages.mockResolvedValue([])
})

describe('HomeworkPage como alumno', () => {
  it('muestra el estado, y lo fuera de término queda marcado', async () => {
    api.fetchHomeworks.mockResolvedValue([
      apiHomework({ submission: apiSubmission() }),
      apiHomework({
        id: 'h2',
        title: 'TP 2',
        submission: apiSubmission({ id: 'e2', submittedAt: ENTREGADA, text: 'x', isLate: true }),
      }),
    ])
    renderPage()

    expect(await screen.findByRole('button', { name: /TP 1/ })).toHaveTextContent('Pendiente')
    expect(screen.getByRole('button', { name: /TP 2/ })).toHaveTextContent('Fuera de término')
  })

  it('entrega un texto y un enlace, y se abre el chat', async () => {
    const tarea = apiHomework({ submission: apiSubmission() })
    api.fetchHomeworks.mockResolvedValue([tarea])
    api.submitHomework.mockResolvedValue({
      ...tarea,
      submission: apiSubmission({
        text: 'Mi trabajo',
        linkUrl: 'https://x.com/tp',
        submittedAt: ENTREGADA,
      }),
    })
    renderPage()
    await abrirTarea()

    expect(screen.queryByText('Mensajes')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Entregar' })).toBeDisabled()

    await userEvent.type(screen.getByLabelText('Texto'), 'Mi trabajo')
    await userEvent.type(screen.getByLabelText('Enlace'), 'https://x.com/tp')
    await userEvent.click(screen.getByRole('button', { name: 'Entregar' }))

    expect(api.submitHomework).toHaveBeenCalledWith('h1', {
      text: 'Mi trabajo',
      linkUrl: 'https://x.com/tp',
    })
    expect(await screen.findByText('Mensajes')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'https://x.com/tp' })).toHaveAttribute(
      'href',
      'https://x.com/tp',
    )
  })

  it('vencida avisa que va a quedar fuera de término', async () => {
    api.fetchHomeworks.mockResolvedValue([
      apiHomework({ dueDate: '2099-09-13', submission: apiSubmission() }),
    ])
    renderPage()
    await abrirTarea()

    expect(screen.getByRole('status')).toHaveTextContent('fuera de término')
  })

  it('corregida muestra la devolución y ya no deja cambiar la entrega', async () => {
    api.fetchHomeworks.mockResolvedValue([
      apiHomework({
        submission: apiSubmission({
          text: 'Mi trabajo',
          submittedAt: ENTREGADA,
          feedback: 'Muy bien',
          correctedAt: ENTREGADA,
        }),
      }),
    ])
    renderPage()
    await abrirTarea()

    expect(screen.getByText('Muy bien')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cambiar entrega' })).not.toBeInTheDocument()
  })

  it('un enlace que no es web no se vuelve link', async () => {
    api.fetchHomeworks.mockResolvedValue([
      apiHomework({
        submission: apiSubmission({ linkUrl: 'javascript:alert(1)', submittedAt: ENTREGADA }),
      }),
    ])
    renderPage()
    await abrirTarea()

    expect(screen.getByText('javascript:alert(1)').closest('a')).toBeNull()
  })

  it('no tiene botón para crear tareas', async () => {
    api.fetchHomeworks.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText('No tenés tareas asignadas por ahora.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Nueva tarea' })).not.toBeInTheDocument()
  })
})

describe('el chat', () => {
  const tarea = apiHomework({ submission: apiSubmission({ text: 'x', submittedAt: ENTREGADA }) })
  const mensaje = (over) => ({
    id: 'm1',
    senderId: 't1',
    senderName: 'Laura Gómez',
    senderRole: 'teacher',
    body: 'Revisá el punto 2',
    createdAt: ENTREGADA,
    ...over,
  })

  it('muestra lo del otro con su nombre y lo propio sin él', async () => {
    api.fetchHomeworks.mockResolvedValue([tarea])
    api.fetchHomeworkMessages.mockResolvedValue([
      mensaje(),
      mensaje({ id: 'm2', senderName: 'Sofía Ramírez', senderRole: 'student', body: 'Dale' }),
    ])
    renderPage()
    await abrirTarea()

    expect(await screen.findByText('Revisá el punto 2')).toBeInTheDocument()
    expect(screen.getByText('Laura Gómez')).toHaveClass('homework-message-author')
    expect(screen.queryByText('Sofía Ramírez')).not.toBeInTheDocument()
    expect(screen.getByText('Dale').closest('li')).toHaveClass('is-mine')
  })

  it('Enter envía, Shift+Enter corta la línea', async () => {
    api.fetchHomeworks.mockResolvedValue([tarea])
    api.sendHomeworkMessage.mockResolvedValue(
      mensaje({ senderRole: 'student', body: 'uno\ndos' }),
    )
    renderPage()
    await abrirTarea()

    const caja = await screen.findByLabelText('Escribí un mensaje')
    await userEvent.type(caja, 'uno{Shift>}{Enter}{/Shift}dos{Enter}')

    expect(api.sendHomeworkMessage).toHaveBeenCalledWith('e1', 'uno\ndos')
    await waitFor(() => expect(caja).toHaveValue(''))
    expect(screen.getByText(/uno/).closest('li')).toHaveClass('is-mine')
  })

  it('trae los mensajes nuevos solo, y deja de preguntar al cerrar', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      api.fetchHomeworks.mockResolvedValue([tarea])
      const { unmount } = renderPage()
      await abrirTarea()
      await screen.findByText('Todavía no hay mensajes sobre esta entrega.')

      api.fetchHomeworkMessages.mockResolvedValue([mensaje()])
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000)
      })
      expect(screen.getByText('Revisá el punto 2')).toBeInTheDocument()

      unmount()
      const llamadas = api.fetchHomeworkMessages.mock.calls.length
      await vi.advanceTimersByTimeAsync(20000)
      expect(api.fetchHomeworkMessages).toHaveBeenCalledTimes(llamadas)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('HomeworkPage como docente', () => {
  const entregas = [
    apiSubmission({ text: 'Mi trabajo', submittedAt: ENTREGADA, isLate: true }),
    apiSubmission({ id: 'e2', studentId: 'a2', studentName: 'Tomás Pérez' }),
  ]
  const tarea = apiHomework({
    classDate: '2099-09-14',
    classStartTime: '13:00',
    subjectName: 'Matemática',
    submissions: entregas,
  })

  it('resume las entregas de la tarea', async () => {
    api.fetchHomeworks.mockResolvedValue([tarea])
    renderPage('teacher')

    const tarjeta = await screen.findByRole('button', { name: /TP 1/ })
    expect(tarjeta).toHaveTextContent('1 de 2 entregaron')
    expect(tarjeta).toHaveTextContent('1 por corregir')
  })

  it('al recargar, la respuesta de docente no rompe mientras el rol sigue en alumno', async () => {
    api.fetchHomeworks.mockResolvedValue([tarea])
    const { rerender } = renderPage('student')
    await waitFor(() => expect(api.fetchHomeworks).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Cargando tareas...')).toBeInTheDocument()

    rerender(
      <MemoryRouter>
        <HomeworkPage viewRole="teacher" now={NOW} />
      </MemoryRouter>,
    )

    expect(await screen.findByRole('button', { name: /TP 1/ })).toBeInTheDocument()
  })

  it('asigna a un alumno', async () => {
    api.fetchHomeworks.mockResolvedValue([])
    api.fetchHomeworkTargets.mockResolvedValue({
      students: [{ id: 'a1', name: 'Sofía Ramírez' }],
      groups: [],
    })
    api.createHomework.mockResolvedValue(
      apiHomework({ title: 'Guía 3', submissions: [apiSubmission()] }),
    )
    renderPage('teacher')

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva tarea' }))
    await userEvent.selectOptions(await screen.findByLabelText('Alumno'), 'a1')
    await userEvent.type(screen.getByLabelText('Título'), 'Guía 3')
    await userEvent.type(screen.getByLabelText('Fecha de entrega'), '2099-09-20')
    await userEvent.click(screen.getByRole('button', { name: 'Asignar tarea' }))

    expect(api.createHomework).toHaveBeenCalledWith({
      title: 'Guía 3',
      description: '',
      dueDate: '2099-09-20',
      dueTime: '23:59',
      studentId: 'a1',
    })
    expect(await screen.findByRole('button', { name: /Guía 3/ })).toBeInTheDocument()
  })

  it('asigna a una clase grupal', async () => {
    api.fetchHomeworks.mockResolvedValue([])
    api.fetchHomeworkTargets.mockResolvedValue({
      students: [],
      groups: [
        {
          classId: 'c1',
          date: '2099-09-14',
          startTime: '13:00',
          subjectName: 'Matemática',
          enrolled: 3,
        },
      ],
    })
    api.createHomework.mockResolvedValue(tarea)
    renderPage('teacher')

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva tarea' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Clase grupal' }))
    await userEvent.selectOptions(screen.getByLabelText('Clase grupal', { selector: 'select' }), 'c1')
    await userEvent.type(screen.getByLabelText('Título'), 'TP')
    await userEvent.type(screen.getByLabelText('Fecha de entrega'), '2099-09-20')
    await userEvent.click(screen.getByRole('button', { name: 'Asignar tarea' }))

    expect(api.createHomework.mock.calls[0][0]).toMatchObject({ classId: 'c1' })
  })

  it('sin destino no deja asignar', async () => {
    api.fetchHomeworks.mockResolvedValue([])
    api.fetchHomeworkTargets.mockResolvedValue({ students: [], groups: [] })
    renderPage('teacher')

    await userEvent.click(await screen.findByRole('button', { name: 'Nueva tarea' }))
    expect(await screen.findByText(/Todavía no tenés alumnos/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Asignar tarea' })).toBeDisabled()
  })

  it('corrige una entrega, marcada fuera de término', async () => {
    api.fetchHomeworks.mockResolvedValue([tarea])
    api.saveHomeworkFeedback.mockResolvedValue({
      ...tarea,
      submissions: [
        { ...entregas[0], feedback: 'Muy bien', correctedAt: ENTREGADA },
        entregas[1],
      ],
    })
    renderPage('teacher')
    await abrirTarea()

    // Sin entrega no hay nada para abrir.
    expect(screen.queryByRole('button', { name: /Tomás Pérez/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Sofía Ramírez/ }))
    const hoja = screen.getByRole('dialog', { name: 'Sofía Ramírez' })
    expect(within(hoja).getByText('Fuera de término')).toBeInTheDocument()

    await userEvent.type(within(hoja).getByLabelText('Devolución'), 'Muy bien')
    await userEvent.click(within(hoja).getByRole('button', { name: 'Corregir' }))

    expect(api.saveHomeworkFeedback).toHaveBeenCalledWith('e1', 'Muy bien')
    expect(await within(hoja).findByText('Devolución guardada.')).toBeInTheDocument()
    expect(within(hoja).getByRole('button', { name: 'Actualizar devolución' })).toBeDisabled()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ClassMaterial from './ClassMaterial.jsx'
import { apiClass } from '../testing/fixtures.js'

const { deleteClassFile, fetchClassMaterial, saveClassSummary, uploadClassFiles } = vi.hoisted(
  () => ({
    deleteClassFile: vi.fn(),
    fetchClassMaterial: vi.fn(),
    saveClassSummary: vi.fn(),
    uploadClassFiles: vi.fn(),
  }),
)

vi.mock('../api/client.js', () => ({
  classFileUrl: (id, fileId) => `/api/classes/${id}/material/files/${fileId}`,
  deleteClassFile,
  fetchClassMaterial,
  saveClassSummary,
  uploadClassFiles,
}))

// La clase es el 14/9 de 13:00 a 14:00.
const TERMINADA = { iso: '2099-09-14', time: '15:00' }
const EN_CURSO = { iso: '2099-09-14', time: '13:30' }
const clase = (over = {}) => apiClass({ status: 'realizada', ...over })
const material = (over = {}) => ({ summary: '', updatedAt: null, files: [], ...over })
const archivo = (over = {}) => ({
  id: 'f1',
  name: 'apunte.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 2048,
  createdAt: '2099-09-14T18:00:00.000Z',
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ClassMaterial', () => {
  it('antes de que termine la clase no pide nada y avisa desde cuándo', () => {
    render(<ClassMaterial cls={clase({ status: 'confirmada' })} viewRole="teacher" now={EN_CURSO} />)

    expect(screen.getByText(/cuando termine la clase/)).toBeInTheDocument()
    expect(fetchClassMaterial).not.toHaveBeenCalled()
  })

  it('el alumno ve el resumen y descarga los archivos, sin poder editar', async () => {
    fetchClassMaterial.mockResolvedValue(
      material({
        summary: 'Vimos derivadas.\nPracticar la guía 3.',
        files: [archivo(), archivo({ id: 'f2', name: 'pizarron.jpg', mimeType: 'image/jpeg' })],
      }),
    )

    render(<ClassMaterial cls={clase()} viewRole="student" now={TERMINADA} />)

    expect(await screen.findByText(/Vimos derivadas/)).toBeInTheDocument()
    expect(screen.getByText('apunte.pdf')).toBeInTheDocument()
    expect(screen.getAllByText('2 KB')).toHaveLength(2)
    expect(screen.getByRole('img', { name: 'pizarron.jpg' })).toHaveAttribute(
      'src',
      '/api/classes/c1/material/files/f2',
    )
    expect(screen.getAllByRole('link', { name: /Descargar/ })[0]).toHaveAttribute('download', 'apunte.pdf')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Adjuntar/ })).not.toBeInTheDocument()
  })

  it('al alumno le dice si todavía no hay material', async () => {
    fetchClassMaterial.mockResolvedValue(material())

    render(<ClassMaterial cls={clase()} viewRole="student" now={TERMINADA} />)

    expect(
      await screen.findByText('El docente todavía no cargó material de esta clase.'),
    ).toBeInTheDocument()
  })

  it('el docente guarda el resumen y avisa que ahora hay material', async () => {
    fetchClassMaterial.mockResolvedValue(material())
    saveClassSummary.mockResolvedValue(material({ summary: 'Vimos límites' }))
    const onChange = vi.fn()

    render(<ClassMaterial cls={clase()} viewRole="teacher" now={TERMINADA} onChange={onChange} />)
    await userEvent.type(await screen.findByLabelText('Resumen de la clase'), 'Vimos límites')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar resumen' }))

    expect(saveClassSummary).toHaveBeenCalledWith('c1', 'Vimos límites')
    expect(await screen.findByText('Resumen guardado.')).toBeInTheDocument()
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('el docente sube varios archivos', async () => {
    fetchClassMaterial.mockResolvedValue(material())
    uploadClassFiles.mockResolvedValue(
      material({ files: [archivo(), archivo({ id: 'f2', name: 'tp.py', mimeType: 'text/x-python' })] }),
    )
    const pdf = new File(['%PDF'], 'apunte.pdf', { type: 'application/pdf' })
    const py = new File(['print(1)'], 'tp.py', { type: 'text/x-python' })

    render(<ClassMaterial cls={clase()} viewRole="teacher" now={TERMINADA} />)
    await screen.findByLabelText('Resumen de la clase')
    await userEvent.upload(screen.getByLabelText('Elegir archivos'), [pdf, py])

    expect(uploadClassFiles).toHaveBeenCalledWith('c1', [pdf, py])
    expect(await screen.findByText('Se subieron 2 archivos.')).toBeInTheDocument()
    expect(screen.getByText('tp.py')).toBeInTheDocument()
  })

  it('un archivo de más de 10 MB no se manda', async () => {
    fetchClassMaterial.mockResolvedValue(material())
    const grande = new File(['x'], 'video.mp4', { type: 'video/mp4' })
    Object.defineProperty(grande, 'size', { value: 11 * 1024 * 1024 })

    render(<ClassMaterial cls={clase()} viewRole="teacher" now={TERMINADA} />)
    await screen.findByLabelText('Resumen de la clase')
    await userEvent.upload(screen.getByLabelText('Elegir archivos'), grande)

    expect(screen.getByText('"video.mp4" pesa más de 10 MB.')).toBeInTheDocument()
    expect(uploadClassFiles).not.toHaveBeenCalled()
  })

  it('el docente borra un archivo después de confirmar', async () => {
    fetchClassMaterial.mockResolvedValue(material({ files: [archivo()] }))
    deleteClassFile.mockResolvedValue(material())
    const onChange = vi.fn()

    render(<ClassMaterial cls={clase()} viewRole="teacher" now={TERMINADA} onChange={onChange} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Borrar apunte.pdf' }))
    expect(deleteClassFile).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: 'Sí, borrar' }))

    expect(deleteClassFile).toHaveBeenCalledWith('c1', 'f1')
    expect(onChange).toHaveBeenCalledWith(false)
  })
})

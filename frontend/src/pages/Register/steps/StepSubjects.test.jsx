import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import StepSubjects from './StepSubjects.jsx'

const SUBJECTS = [
  { id: 'a1', name: 'Matemática' },
  { id: 'b2', name: 'Física' },
]

function renderStep(props = {}) {
  const onRetry = vi.fn()
  render(
    <StepSubjects
      subjects={[]}
      selectedIds={[]}
      onToggle={vi.fn()}
      onBack={vi.fn()}
      onSubmit={vi.fn()}
      onRetry={onRetry}
      {...props}
    />,
  )
  return { onRetry }
}

describe('StepSubjects', () => {
  it('muestra las materias cuando cargaron', () => {
    renderStep({ subjects: SUBJECTS })
    expect(screen.getByText('Matemática')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })

  it('si la carga falla muestra el error y no la lista vacía', () => {
    // Sin esto el docente veía "No se encontraron materias" y creía que no
    // había ninguna, sin forma de saber que tenía que reintentar.
    renderStep({ loadError: 'No se pudieron cargar las materias.' })
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudieron cargar las materias.')
    expect(screen.queryByText('No se encontraron materias.')).not.toBeInTheDocument()
  })

  it('Reintentar vuelve a pedir las materias', async () => {
    const { onRetry } = renderStep({ loadError: 'No se pudieron cargar las materias.' })
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('mientras carga no muestra el error', () => {
    renderStep({ loading: true, loadError: null })
    expect(screen.getByText(/Cargando materias/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })
})

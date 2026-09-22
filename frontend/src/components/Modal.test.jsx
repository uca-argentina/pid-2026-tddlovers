import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Modal from './Modal.jsx'

function renderModal(extra = null) {
  const onClose = vi.fn()
  render(
    <div>
      <button type="button">Afuera</button>
      <Modal title="Reservar clase" onClose={onClose}>
        <button type="button">Confirmar</button>
        {extra}
      </Modal>
    </div>,
  )
  return { onClose }
}

describe('Modal', () => {
  it('se anuncia como diálogo por su título', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Reservar clase' })).toBeInTheDocument()
  })

  it('sale del árbol y cuelga del body', () => {
    // Va por portal a propósito: adentro de la pantalla hay contenedores con
    // overflow oculto y divs animados que lo recortarían.
    renderModal()
    expect(screen.getByRole('dialog').closest('.modal-backdrop').parentElement).toBe(document.body)
  })

  it('el foco entra al abrir', () => {
    // Al primer enfocable, que es el de cerrar: quien navega con teclado
    // empieza adentro del diálogo y con la salida a mano.
    renderModal()
    expect(screen.getByRole('button', { name: 'Cerrar' })).toHaveFocus()
  })

  it('Escape cierra', async () => {
    const { onClose } = renderModal()

    await userEvent.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('el botón de cerrar cierra', async () => {
    const { onClose } = renderModal()

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar' }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tocar el fondo cierra, pero tocar el panel no', async () => {
    const { onClose } = renderModal()

    await userEvent.click(screen.getByRole('dialog'))
    expect(onClose).not.toHaveBeenCalled()

    await userEvent.click(document.querySelector('.modal-backdrop'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('tabular no se escapa a lo que quedó atrás', async () => {
    renderModal()
    const confirmar = screen.getByRole('button', { name: 'Confirmar' })
    const cerrar = screen.getByRole('button', { name: 'Cerrar' })

    // El orden adentro es cerrar -> confirmar: desde el último, tabular da la
    // vuelta al primero en vez de irse al botón que quedó atrás.
    confirmar.focus()
    await userEvent.tab()
    expect(cerrar).toHaveFocus()

    // Y para el otro lado igual.
    await userEvent.tab({ shift: true })
    expect(confirmar).toHaveFocus()
  })

  it('al cerrarse el foco vuelve a donde estaba', async () => {
    render(<button type="button">Reservar</button>)
    const disparador = screen.getByRole('button', { name: 'Reservar' })
    disparador.focus()

    const { unmount } = render(<Modal title="Reservar clase" onClose={() => {}} />)
    unmount()

    expect(disparador).toHaveFocus()
  })

  it('mientras está abierto el fondo no scrollea', () => {
    const { unmount } = render(<Modal title="Reservar clase" onClose={() => {}} />)
    expect(document.body.style.overflow).toBe('hidden')

    unmount()
    expect(document.body.style.overflow).toBe('')
  })
})

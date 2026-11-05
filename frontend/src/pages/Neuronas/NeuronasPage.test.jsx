import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import NeuronasPage from './NeuronasPage.jsx'
import { apiNeuronas, apiTeacherNeuronas, apiUser } from '../../testing/fixtures.js'

const { buyFeatured, fetchNeuronas } = vi.hoisted(() => ({
  buyFeatured: vi.fn(),
  fetchNeuronas: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({ buyFeatured, fetchNeuronas }))

function renderPage(props = {}) {
  return render(
    <MemoryRouter>
      <NeuronasPage viewRole="student" user={apiUser()} {...props} />
    </MemoryRouter>,
  )
}

describe('NeuronasPage', () => {
  beforeEach(() => {
    buyFeatured.mockReset()
    fetchNeuronas.mockReset()
  })

  it('el alumno ve saldo, nivel, insignias y premios', async () => {
    fetchNeuronas.mockResolvedValue(apiNeuronas())
    renderPage()

    // También hay un premio de 250: se busca el saldo por su etiqueta.
    const saldo = await screen.findByText('Tu saldo')
    expect(saldo.nextElementSibling).toHaveTextContent('250 neuronas')
    expect(screen.getByText('Sinapsis')).toBeInTheDocument()
    expect(screen.getByText(/Faltan 350 neuronas para Red neuronal/)).toBeInTheDocument()
    expect(screen.getByText(/✓\s*Primera clase/)).toBeInTheDocument()
    expect(screen.getByText('1 h gratis')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Destacarme' })).not.toBeInTheDocument()
  })

  it('muestra el historial con lo ganado y lo gastado', async () => {
    fetchNeuronas.mockResolvedValue(
      apiNeuronas({
        movements: [
          {
            id: 'm1',
            reason: 'class_attended',
            amount: 10,
            detail: 'Matemática',
            createdAt: '2099-09-14T15:00:00.000Z',
          },
          {
            id: 'm2',
            reason: 'class_reward',
            amount: -500,
            detail: 'Física',
            createdAt: '2099-09-15T15:00:00.000Z',
          },
        ],
      }),
    )
    renderPage()

    // "Clase con presente" también está en "Cómo se ganan": se busca el detalle.
    expect(await screen.findByText(/^Matemática · /)).toBeInTheDocument()
    expect(screen.getByText('+10')).toBeInTheDocument()
    expect(screen.getByText('−500')).toBeInTheDocument()
  })

  it('el docente compra Destacado y se actualiza', async () => {
    fetchNeuronas.mockResolvedValueOnce(apiTeacherNeuronas()).mockResolvedValueOnce(
      apiTeacherNeuronas({
        balance: 200,
        featured: { activeUntil: '2099-09-20', slotsLeft: 4, cost: 1000, days: 7 },
      }),
    )
    buyFeatured.mockResolvedValue({ endDate: '2099-09-20' })
    renderPage({ viewRole: 'teacher' })

    await userEvent.click(await screen.findByRole('button', { name: 'Destacarme' }))

    await waitFor(() => expect(buyFeatured).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Estás destacado hasta/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Destacarme' })).not.toBeInTheDocument()
  })

  it('no deja comprar sin saldo, y dice cuánto falta', async () => {
    fetchNeuronas.mockResolvedValue(apiTeacherNeuronas({ balance: 300 }))
    renderPage({ viewRole: 'teacher' })

    expect(await screen.findByRole('button', { name: 'Destacarme' })).toBeDisabled()
    expect(screen.getByText('Te faltan 700 neuronas.')).toBeInTheDocument()
  })

  it('un docente sin aprobar no puede comprar', async () => {
    fetchNeuronas.mockResolvedValue(apiTeacherNeuronas())
    renderPage({ viewRole: 'teacher', user: apiUser({ approvalStatus: 'pending' }) })

    expect(await screen.findByRole('button', { name: 'Destacarme' })).toBeDisabled()
    expect(screen.getByText(/cuando un administrador te apruebe/)).toBeInTheDocument()
  })

  it('avisa si falla la compra', async () => {
    fetchNeuronas.mockResolvedValue(apiTeacherNeuronas())
    buyFeatured.mockRejectedValue(new Error('Ya no quedan lugares de Destacado.'))
    renderPage({ viewRole: 'teacher' })

    await userEvent.click(await screen.findByRole('button', { name: 'Destacarme' }))

    expect(await screen.findByText('Ya no quedan lugares de Destacado.')).toBeInTheDocument()
  })

  it('avisa si falla la carga', async () => {
    fetchNeuronas.mockRejectedValue(new Error('Se cortó'))
    renderPage()

    expect(await screen.findByText('Se cortó')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import PacksPage from './PacksPage.jsx'
import { apiStudentPack, apiUser } from '../../testing/fixtures.js'

const { fetchMyPacks, fetchPackOffers } = vi.hoisted(() => ({
  fetchMyPacks: vi.fn(),
  fetchPackOffers: vi.fn(),
}))

vi.mock('../../api/client.js', () => ({
  buyPack: vi.fn(),
  createPackOffer: vi.fn(),
  deletePackOffer: vi.fn(),
  fetchMyPackOffers: vi.fn(),
  fetchMyPacks,
  fetchPackOffers,
}))

const alumno = apiUser({ role: 'student', approvalStatus: null })

function renderPage() {
  return render(
    <MemoryRouter>
      <PacksPage viewRole="student" user={alumno} />
    </MemoryRouter>,
  )
}

describe('PacksPage — alumno', () => {
  beforeEach(() => {
    fetchPackOffers.mockReset().mockResolvedValue([])
  })

  it('en un paquete vigente dice cuántas le quedan de cuántas', async () => {
    fetchMyPacks.mockReset().mockResolvedValue([apiStudentPack({ remaining: 1, available: 1 })])
    renderPage()
    expect(await screen.findByText(/Te queda/)).toHaveTextContent('Te queda 1 clase de 2')
  })

  it('en uno vencido no dice "te quedan": dice cuántas quedaron sin usar', async () => {
    // Bug: un paquete vencido decía "Te quedan 2 clases de 2".
    fetchMyPacks.mockReset().mockResolvedValue([
      apiStudentPack({ expired: true, usable: false, expiresOn: '2020-01-01' }),
    ])
    renderPage()
    expect(await screen.findByText(/Sin usar/)).toHaveTextContent('Sin usar: 2 clases')
    expect(screen.queryByText(/Te quedan/)).not.toBeInTheDocument()
  })
})

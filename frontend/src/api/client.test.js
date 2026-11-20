import { fetchAvailability } from './client.js'

describe('fetchAvailability', () => {
  let fetchMock

  beforeEach(() => {
    fetchMock = vi.fn(() => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('pide el rango', async () => {
    await fetchAvailability({ from: '2026-11-01', to: '2026-11-30' })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/availability?from=2026-11-01&to=2026-11-30')
  })

  it('al reprogramar manda la clase que no tiene que contar como ocupada', async () => {
    await fetchAvailability({ from: '2026-11-01', to: '2026-11-30', excludeBookingId: 'c9 &x' })
    const url = new URL(fetchMock.mock.calls[0][0], 'http://127.0.0.1')
    expect(url.pathname).toBe('/api/availability')
    expect(url.searchParams.get('excludeBookingId')).toBe('c9 &x')
    expect(url.searchParams.get('from')).toBe('2026-11-01')
  })
})

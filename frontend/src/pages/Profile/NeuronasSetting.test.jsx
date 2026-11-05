import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NeuronasSetting from './NeuronasSetting.jsx'

const setAcceptsRewards = vi.hoisted(() => vi.fn())

vi.mock('../../api/client.js', () => ({ setAcceptsRewards }))

describe('NeuronasSetting', () => {
  beforeEach(() => {
    setAcceptsRewards.mockReset()
  })

  it('guarda al momento y avisa para arriba', async () => {
    setAcceptsRewards.mockResolvedValue({ acceptsRewards: true })
    const onChange = vi.fn()
    render(<NeuronasSetting accepts={false} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: /Aceptar canjes/ }))

    expect(setAcceptsRewards).toHaveBeenCalledWith(true)
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(true))
  })

  it('si falla lo dice y no cambia', async () => {
    setAcceptsRewards.mockRejectedValue(new Error('Se cortó'))
    const onChange = vi.fn()
    render(<NeuronasSetting accepts={false} onChange={onChange} />)

    await userEvent.click(screen.getByRole('checkbox', { name: /Aceptar canjes/ }))

    expect(await screen.findByText('Se cortó')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: /Aceptar canjes/ })).not.toBeChecked()
  })
})

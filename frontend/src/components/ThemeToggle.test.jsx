import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ThemeToggle from './ThemeToggle.jsx'

describe('ThemeToggle', () => {
  beforeEach(() => {
    localStorage.clear()
    delete document.documentElement.dataset.theme
  })

  it('no pisa el tema del sistema mientras el usuario no elija', () => {
    // jsdom no implementa matchMedia, así que prefersDark() da false y el
    // botón ofrece pasar a oscuro; lo importante es que <html> quede limpio
    // para que mande la media query del sistema.
    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(screen.getByLabelText('Cambiar a modo oscuro')).toBeInTheDocument()
  })

  it('cambia el tema del documento al tocarlo', async () => {
    render(<ThemeToggle />)

    await userEvent.click(screen.getByLabelText('Cambiar a modo oscuro'))
    expect(document.documentElement.dataset.theme).toBe('dark')

    await userEvent.click(screen.getByLabelText('Cambiar a modo claro'))
    expect(document.documentElement.dataset.theme).toBe('light')
  })

  it('se acuerda de lo elegido', async () => {
    const { unmount } = render(<ThemeToggle />)
    await userEvent.click(screen.getByLabelText('Cambiar a modo oscuro'))
    unmount()

    render(<ThemeToggle />)
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(screen.getByLabelText('Cambiar a modo claro')).toBeInTheDocument()
  })
})

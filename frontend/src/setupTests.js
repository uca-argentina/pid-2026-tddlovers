// Se carga antes de cada archivo de test (ver vite.config: test.setupFiles).

// Agrega los matchers de jest-dom (toBeInTheDocument, toHaveTextContent, etc.)
// al `expect` de Vitest.
import '@testing-library/jest-dom/vitest';

// Con `globals: true` en vite.config, Testing Library debería limpiar el
// DOM solo después de cada test, pero lo registramos también a mano para
// no depender de eso.
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

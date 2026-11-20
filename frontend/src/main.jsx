// Punto de entrada de Vite (lo carga index.html): monta <App /> en #root,
// con los estilos globales de index.css. StrictMode monta dos veces en dev:
// por eso algunos componentes (p. ej. routes/withFavorites.jsx) descartan
// respuestas viejas con un token.
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

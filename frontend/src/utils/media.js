// Preguntas sobre el tamaño de la pantalla desde JS, para los casos en los
// que el CSS no alcanza: el scheduler no solo se ve distinto en un teléfono,
// directamente renderiza un día en vez de siete (48 celdas en vez de 336), y
// eso hay que decidirlo en el render, no con un display: none.
//
// Van con el mismo guard que prefersDark() en theme.js: jsdom NO implementa
// window.matchMedia —ni siquiera un stub—, así que sin esto todos los tests
// que monten el scheduler se caen con "matchMedia is not a function".

export function matchesQuery(query) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }
  return window.matchMedia(query).matches
}

/**
 * Avisa cuando la consulta pasa a cumplirse o a no cumplirse. Devuelve una
 * función para desuscribirse, o null si el navegador no sabe contestar — así
 * quien lo use puede escribir `this.unwatch?.()` sin preguntar nada.
 */
export function watchQuery(query, handler) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return null
  }

  const list = window.matchMedia(query)
  const listener = (event) => handler(event.matches)

  // addEventListener es lo moderno; addListener es lo que entienden Safari
  // viejo y algún stub de test.
  if (typeof list.addEventListener === 'function') {
    list.addEventListener('change', listener)
    return () => list.removeEventListener('change', listener)
  }
  if (typeof list.addListener === 'function') {
    list.addListener(listener)
    return () => list.removeListener(listener)
  }

  return null
}

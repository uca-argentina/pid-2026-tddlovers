import { Component, createRef } from 'react'
import withRouter from '../routes/withRouter.jsx'
import { fetchSubjects, fetchTeachers } from '../api/client.js'
import { suggest, teacherFullName } from '../utils/search.js'
import { SearchIcon } from './icons.jsx'
import './SearchBar.css'

const LISTBOX_ID = 'search-suggest'

/**
 * Buscador de la barra superior, predictivo: mientras se tipea muestra
 * materias y docentes que coinciden, en dos secciones separadas. Elegir una
 * sugerencia (o enviar el texto tal cual) lleva a la pantalla de reservar con
 * lo buscado en la URL, donde se convierte en un filtro más (ver
 * pages/Booking/BookingBoard.jsx).
 *
 * Reusa la forma del buscador de materias de SubjectPicker (ícono a la
 * izquierda, input con padding para no taparlo), pero redondeado como
 * pastilla para que se lea como parte de la barra.
 */
class SearchBar extends Component {
  state = {
    query: '',
    open: false,
    // Índice dentro de la lista plana (materias y después docentes); -1 es
    // "ninguna resaltada", y ahí Enter envía el texto como antes.
    activeIndex: -1,
    catalog: { subjects: [], teachers: [] },
    // Dónde va la lista, medido desde el input (ver placePanel).
    panel: null,
  }

  inputRef = createRef()

  listRef = createRef()

  // Se pide el catálogo una sola vez, al primer foco: la barra está en todas
  // las pantallas y no tiene sentido cargar docentes si nadie la toca.
  catalogRequested = false

  // Token y no un booleano "ya me desmonté": en dev StrictMode desmonta y
  // vuelve a montar la MISMA instancia, y un booleano quedaba prendido para
  // siempre, tirando a la basura todas las respuestas. Mismo patrón que
  // rangeToken/subjectsToken en BookingBoard.
  catalogToken = 0

  componentDidMount() {
    window.addEventListener('resize', this.placePanel)
  }

  componentDidUpdate(prevProps, prevState) {
    if (prevState.activeIndex !== this.state.activeIndex && this.state.activeIndex >= 0) {
      // Cada sección scrollea por su cuenta: sin esto, bajar con la flecha
      // más allá de la tercera fila resaltaría algo que no se ve.
      const activo = this.listRef.current?.querySelector('[aria-selected="true"]')
      activo?.scrollIntoView?.({ block: 'nearest' })
    }
  }

  componentWillUnmount() {
    this.catalogToken += 1
    // La respuesta en vuelo se va a descartar: si la instancia vuelve a
    // montarse, que pueda pedirlo de nuevo.
    this.catalogRequested = false
    window.removeEventListener('resize', this.placePanel)
  }

  /**
   * La lista va con position: fixed y medida a mano porque en escritorio el
   * buscador vive dentro de la barra lateral, que tiene overflow: auto y
   * recortaría todo lo que se salga de sus 232px. Fixed escapa de ese
   * recorte; en el teléfono la barra ya ocupa todo el ancho y la cuenta da lo
   * mismo que un width: 100%.
   */
  placePanel = () => {
    const input = this.inputRef.current
    if (!input) return
    const rect = input.getBoundingClientRect()
    const margen = 12
    const width = Math.min(Math.max(rect.width, 320), window.innerWidth - rect.left - margen)
    this.setState({ panel: { top: rect.bottom + 6, left: rect.left, width } })
  }

  loadCatalog() {
    if (this.catalogRequested) return
    this.catalogRequested = true
    const token = ++this.catalogToken

    // allSettled y no all: sin sesión /api/teachers da 401, y eso no es
    // motivo para dejar de sugerir materias.
    Promise.allSettled([fetchSubjects(), fetchTeachers()]).then(([materias, docentes]) => {
      if (token !== this.catalogToken) return
      const lista = (result) =>
        result.status === 'fulfilled' && Array.isArray(result.value) ? result.value : []
      this.setState({ catalog: { subjects: lista(materias), teachers: lista(docentes) } })
      // Si falló todo se vuelve a probar en el próximo foco.
      if (materias.status === 'rejected' && docentes.status === 'rejected') {
        this.catalogRequested = false
      }
    })
  }

  getSuggestions() {
    const { subjects, teachers } = suggest(this.state.query, this.state.catalog)
    const options = [
      ...subjects.map((subject) => ({ type: 'subject', id: subject.id, label: subject.name })),
      ...teachers.map((teacher) => ({
        type: 'teacher',
        id: teacher.id,
        label: teacherFullName(teacher),
        detail: (teacher.subjects || []).map((subject) => subject.name).join(' · '),
      })),
    ]
    return { options, subjectCount: subjects.length }
  }

  isOpen() {
    return this.state.open && this.state.query.trim() !== ''
  }

  goTo(q) {
    this.props.router.navigate(
      q ? `/disponibilidad?q=${encodeURIComponent(q)}` : '/disponibilidad',
    )
  }

  select(option) {
    this.setState({ query: option.label, open: false, activeIndex: -1 })
    // Las dos van por ?q=: resolveQuery ya distingue materia de docente y,
    // a diferencia de /disponibilidad/:materiaId, pisa también el filtro de
    // docente que hubiera quedado de una búsqueda anterior.
    this.goTo(option.label)
  }

  handleFocus = () => {
    this.loadCatalog()
    this.placePanel()
    this.setState({ open: true })
  }

  handleBlur = () => {
    this.setState({ open: false, activeIndex: -1 })
  }

  handleChange = (event) => {
    this.setState({ query: event.target.value, open: true, activeIndex: -1 })
  }

  handleKeyDown = (event) => {
    if (event.key === 'Escape') {
      this.setState({ open: false, activeIndex: -1 })
      return
    }

    if (!this.isOpen()) return
    const { options } = this.getSuggestions()

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (options.length === 0) return
      const paso = event.key === 'ArrowDown' ? 1 : -1
      this.setState(({ activeIndex }) => ({
        activeIndex: (activeIndex + paso + options.length) % options.length,
      }))
      return
    }

    if (event.key === 'Enter' && options[this.state.activeIndex]) {
      event.preventDefault()
      this.select(options[this.state.activeIndex])
    }
  }

  // mousedown y no click: el click llega después del blur del input, que ya
  // habría cerrado la lista y desmontado la fila.
  handleOptionMouseDown = (option) => (event) => {
    event.preventDefault()
    this.select(option)
  }

  handleSubmit = (event) => {
    event.preventDefault()
    const q = this.state.query.trim()
    this.setState({ open: false, activeIndex: -1 })

    // Se navega al ENVIAR o al elegir una sugerencia, nunca mientras se
    // tipea: esta barra vive en todas las pantallas, así que buscar por tecla
    // te sacaría del calendario a la mitad de una palabra y cada letra sería
    // una entrada del historial.
    //
    // Lo buscado lo interpreta la pantalla de reservar: si es una materia
    // queda elegida como si se hubiera tocado el chip, y si no se toma como
    // nombre de docente (ver resolveQuery en utils/booking.js).
    this.goTo(q)
  }

  renderOption(option, index) {
    const activo = index === this.state.activeIndex
    const etiqueta = option.type === 'subject' ? 'Materia' : 'Docente'
    return (
      <li
        key={`${option.type}-${option.id}`}
        id={`${LISTBOX_ID}-${index}`}
        role="option"
        aria-selected={activo}
        className={`search-option ${activo ? 'is-active' : ''}`}
        onMouseDown={this.handleOptionMouseDown(option)}
        onMouseEnter={() => this.setState({ activeIndex: index })}
      >
        <span className="search-option-text">
          <span className="search-option-label">{option.label}</span>
          {option.detail ? <span className="search-option-detail">{option.detail}</span> : null}
        </span>
        <span className={`search-option-tag is-${option.type}`}>{etiqueta}</span>
      </li>
    )
  }

  renderSection(title, slug, options, offset) {
    if (options.length === 0) return null
    const headingId = `${LISTBOX_ID}-${slug}`
    return (
      <div className="search-section">
        <p className="search-section-title" id={headingId}>
          {title}
        </p>
        <ul className="search-section-list" role="group" aria-labelledby={headingId}>
          {options.map((option, i) => this.renderOption(option, offset + i))}
        </ul>
      </div>
    )
  }

  renderSuggestions() {
    const { options, subjectCount } = this.getSuggestions()
    const materias = options.slice(0, subjectCount)
    const docentes = options.slice(subjectCount)

    return (
      <div
        className="search-suggest"
        id={LISTBOX_ID}
        role="listbox"
        ref={this.listRef}
        style={this.state.panel || undefined}
      >
        {options.length === 0 ? (
          <p className="search-suggest-empty">
            No encontramos materias ni docentes para “{this.state.query.trim()}”.
          </p>
        ) : (
          <>
            {this.renderSection('Materias', 'materias', materias, 0)}
            {this.renderSection('Docentes', 'docentes', docentes, subjectCount)}
          </>
        )}
      </div>
    )
  }

  render() {
    const abierto = this.isOpen()
    const { activeIndex } = this.state

    return (
      <form className="search-bar" role="search" onSubmit={this.handleSubmit}>
        <SearchIcon />
        <input
          ref={this.inputRef}
          type="search"
          role="combobox"
          value={this.state.query}
          onChange={this.handleChange}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          onKeyDown={this.handleKeyDown}
          placeholder="Buscar docentes o materias..."
          aria-label="Buscar docentes o materias"
          aria-autocomplete="list"
          aria-expanded={abierto}
          aria-controls={LISTBOX_ID}
          aria-activedescendant={
            abierto && activeIndex >= 0 ? `${LISTBOX_ID}-${activeIndex}` : undefined
          }
          autoComplete="off"
        />
        {abierto ? this.renderSuggestions() : null}
      </form>
    )
  }
}

export default withRouter(SearchBar)

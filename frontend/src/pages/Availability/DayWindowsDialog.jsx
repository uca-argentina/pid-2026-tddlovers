import { Component } from 'react'
import { Link } from 'react-router-dom'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  PlusIcon,
  SpinnerIcon,
} from '../../components/icons.jsx'
import WindowCard from './WindowCard.jsx'
import WindowForm from './WindowForm.jsx'
import { createWindow, deleteWindow, updateWindow } from '../../api/client.js'
import { addDays, formatDayLong, fromISODate, toISODate } from '../../utils/calendar.js'
import {
  draftFromWindow,
  draftToPayload,
  emptyDraft,
  validateDraft,
  windowsOn,
} from '../../utils/windows.js'
import './DayWindowsDialog.css'

const NEW = 'new'

/**
 * El modal de un día: cada ventana de disponibilidad de ese día es una
 * tarjeta, y desde acá se agregan, editan y borran. Las flechas de arriba
 * pasan al día anterior o siguiente sin cerrar el modal.
 *
 * Una sola tarjeta en edición a la vez, y mientras se edita no se puede
 * cambiar de día: el borrador es de ESE día, y perderlo por tocar una flecha
 * sería peor que tener que guardar o cancelar primero.
 *
 * El modal no guarda ventanas propias: las recibe de TeacherAvailability, y
 * después de cada cambio le pide que recargue (`onChanged`). Así la semana de
 * atrás y el modal nunca muestran dos versiones distintas.
 */
class DayWindowsDialog extends Component {
  constructor(props) {
    super(props)
    this.state = {
      editing: null,
      draft: null,
      // La ventana tal como estaba antes de editar: hace falta para saber si
      // era semanal y a qué fecha volver si se destilda y se vuelve a tildar.
      original: null,
      showErrors: false,
      saving: false,
      serverError: null,
      confirmDeleteId: null,
      deleting: false,
      notice: null,
    }
  }

  focusedRef = null

  unmounted = false

  componentDidMount() {
    // Se resetea acá y no solo al declararlo: en desarrollo StrictMode
    // desmonta y vuelve a montar la MISMA instancia, y si quedaba en true
    // después de guardar no se cerraba el formulario.
    this.unmounted = false
    // jsdom no implementa scrollIntoView: el ?. hace que los tests no se caigan.
    this.focusedRef?.scrollIntoView?.({ block: 'nearest' })
  }

  componentDidUpdate(prevProps) {
    if (prevProps.iso !== this.props.iso) {
      this.setState({ notice: null, confirmDeleteId: null })
    }
  }

  componentWillUnmount() {
    this.unmounted = true
  }

  setFocusedRef = (node) => {
    this.focusedRef = node
  }

  /** Un día que ya pasó se mira, no se toca: esas clases ya fueron. */
  canEdit() {
    return this.props.iso >= this.props.today
  }

  newDraft() {
    const { iso, subjects } = this.props
    // Con una sola materia no hay nada que elegir.
    return emptyDraft({ date: iso, subjectId: subjects.length === 1 ? subjects[0].id : '' })
  }

  getWindows() {
    return windowsOn(this.props.windows, this.props.iso)
  }

  isTaught(window) {
    return this.props.subjects.some((subject) => String(subject.id) === String(window.subjectId))
  }

  /**
   * Las materias para el select. Si la ventana que se edita es de una
   * materia que ya no está en el perfil, se agrega igual para que el select
   * no aparezca vacío; el backend no va a dejar guardarla, y lo dice.
   */
  getSubjects() {
    const { subjects } = this.props
    const { original } = this.state
    if (!original || this.isTaught(original)) return subjects
    return [...subjects, { id: original.subjectId, name: original.subjectName }]
  }

  handleDay = (delta) => () => {
    this.props.onChangeDay(toISODate(addDays(fromISODate(this.props.iso), delta)))
  }

  handleAdd = () => {
    this.setState({
      editing: NEW,
      draft: this.newDraft(),
      original: null,
      showErrors: false,
      serverError: null,
      confirmDeleteId: null,
      notice: null,
    })
  }

  handleEdit = (window) => () => {
    this.setState({
      editing: window.id,
      draft: draftFromWindow(window),
      original: window,
      showErrors: false,
      serverError: null,
      confirmDeleteId: null,
      notice: null,
    })
  }

  handleCancelEdit = () => {
    this.setState({ editing: null, draft: null, original: null, serverError: null })
  }

  handleChangeDraft = (draft) => {
    this.setState({ draft, serverError: null })
  }

  /**
   * Destildar "repetir" deja la ventana solo en el día que se está mirando,
   * que puede no ser su fecha original (una semanal que arrancó hace un mes).
   * Volver a tildarla recupera la fecha original: si no, la serie arrancaría
   * de nuevo desde hoy y las semanas del medio quedarían vacías.
   */
  handleToggleRepeat = (repeatsWeekly) => {
    this.setState((prev) => {
      let { date } = prev.draft
      if (!repeatsWeekly) date = this.props.iso
      else if (prev.original?.repeatsWeekly) date = prev.original.date
      return { draft: { ...prev.draft, repeatsWeekly, date } }
    })
  }

  /**
   * Guardar y después recargar la semana. El aviso de "guardado" recién sale
   * cuando la recarga volvió: antes, la tarjeta todavía mostraría lo viejo.
   */
  handleSubmit = () => {
    const { draft, editing, saving } = this.state
    if (saving) return

    if (Object.keys(validateDraft(draft)).length > 0) {
      this.setState({ showErrors: true })
      return
    }

    this.setState({ saving: true, serverError: null, showErrors: true })
    const payload = draftToPayload(draft)
    const pedido = editing === NEW ? createWindow(payload) : updateWindow(editing, payload)

    pedido
      .then(() => this.props.onChanged())
      .then(() => {
        if (this.unmounted) return
        this.setState({
          editing: null,
          draft: null,
          original: null,
          saving: false,
          notice: editing === NEW ? 'Listo, agregamos la clase.' : 'Listo, guardamos los cambios.',
        })
      })
      .catch((error) => {
        if (this.unmounted) return
        this.setState({
          saving: false,
          serverError: error.message || 'No se pudo guardar la clase. Probá de nuevo.',
        })
      })
  }

  handleAskDelete = (id) => () => {
    this.setState({ confirmDeleteId: id, notice: null, serverError: null })
  }

  handleCancelDelete = () => {
    this.setState({ confirmDeleteId: null })
  }

  handleDelete = () => {
    const { confirmDeleteId, deleting } = this.state
    if (deleting) return

    this.setState({ deleting: true, serverError: null })
    deleteWindow(confirmDeleteId)
      .then(() => this.props.onChanged())
      .then(() => {
        if (this.unmounted) return
        this.setState({ deleting: false, confirmDeleteId: null, notice: 'Listo, eliminamos la clase.' })
      })
      .catch((error) => {
        if (this.unmounted) return
        this.setState({
          deleting: false,
          serverError: error.message || 'No se pudo eliminar la clase. Probá de nuevo.',
        })
      })
  }

  renderNav() {
    const { iso, today } = this.props
    const editando = this.state.editing !== null
    const fecha = fromISODate(iso)

    return (
      <div className="day-dialog-nav">
        <button
          type="button"
          className="day-dialog-arrow"
          onClick={this.handleDay(-1)}
          disabled={editando}
          aria-label="Día anterior"
        >
          <ChevronLeftIcon />
        </button>
        <div className="day-dialog-date" aria-live="polite">
          <span className="day-dialog-date-text">{formatDayLong(fecha)}</span>
          {iso === today ? <span className="day-dialog-tag">Hoy</span> : null}
          {iso < today ? <span className="day-dialog-tag is-past">Ya pasó</span> : null}
        </div>
        <button
          type="button"
          className="day-dialog-arrow"
          onClick={this.handleDay(1)}
          disabled={editando}
          aria-label="Día siguiente"
        >
          <ChevronRightIcon />
        </button>
      </div>
    )
  }

  renderForm(isNew) {
    const { draft, original, saving, showErrors, serverError } = this.state
    return (
      <li key={isNew ? NEW : original.id} className="window-card is-editing">
        <WindowForm
          draft={draft}
          iso={this.props.iso}
          subjects={this.getSubjects()}
          isNew={isNew}
          originalRepeats={Boolean(original?.repeatsWeekly)}
          saving={saving}
          showErrors={showErrors}
          serverError={serverError}
          onChange={this.handleChangeDraft}
          onToggleRepeat={this.handleToggleRepeat}
          onSubmit={this.handleSubmit}
          onCancel={this.handleCancelEdit}
        />
      </li>
    )
  }

  renderCards(windows) {
    const { focusId } = this.props
    const { editing, confirmDeleteId, deleting } = this.state
    const readOnly = !this.canEdit() || editing !== null

    return windows.map((window) => {
      if (editing === window.id) return this.renderForm(false)
      const focused = String(window.id) === String(focusId)
      return (
        <WindowCard
          key={window.id}
          window={window}
          focused={focused}
          cardRef={focused ? this.setFocusedRef : undefined}
          notTaught={!this.isTaught(window)}
          readOnly={readOnly}
          confirming={confirmDeleteId === window.id}
          deleting={deleting}
          onEdit={this.handleEdit(window)}
          onAskDelete={this.handleAskDelete(window.id)}
          onCancelDelete={this.handleCancelDelete}
          onDelete={this.handleDelete}
        />
      )
    })
  }

  renderFooter() {
    const { subjects } = this.props
    if (!this.canEdit()) {
      return (
        <p className="day-dialog-note">Este día ya pasó: podés ver lo que ofreciste, no cambiarlo.</p>
      )
    }
    if (this.state.editing !== null) return null
    if (subjects.length === 0) {
      return (
        <p className="day-dialog-note">
          Para cargar clases primero elegí qué materias das.{' '}
          <Link className="auth-link" to="/perfil">
            Ir a mi perfil
          </Link>
        </p>
      )
    }
    return (
      <button type="button" className="day-dialog-add" onClick={this.handleAdd}>
        <PlusIcon />
        Agregar clase
      </button>
    )
  }

  render() {
    const { loading, onClose } = this.props
    const { editing, notice, serverError } = this.state
    const windows = this.getWindows()
    const vacio = windows.length === 0 && editing !== NEW

    return (
      <Modal title="Clases del día" onClose={onClose}>
        <div className="day-dialog">
          {this.renderNav()}

          {notice ? <Banner type="success">{notice}</Banner> : null}
          {/* El error de guardar va adentro del formulario; este es el de
              borrar, que no tiene formulario. */}
          {serverError && editing === null ? <Banner type="danger">{serverError}</Banner> : null}

          {loading && vacio ? (
            <p className="day-dialog-empty">
              <SpinnerIcon className="spin" />
              Cargando...
            </p>
          ) : null}
          {!loading && vacio ? (
            <p className="day-dialog-empty">No ofrecés clases este día.</p>
          ) : null}

          {windows.length > 0 || editing === NEW ? (
            <ul className="window-cards">
              {this.renderCards(windows)}
              {editing === NEW ? this.renderForm(true) : null}
            </ul>
          ) : null}

          {this.renderFooter()}
        </div>
      </Modal>
    )
  }
}

DayWindowsDialog.defaultProps = {
  windows: [],
  subjects: [],
  loading: false,
  focusId: null,
}

export default DayWindowsDialog

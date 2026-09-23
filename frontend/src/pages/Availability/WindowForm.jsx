import { Component } from 'react'
import Banner from '../../components/Banner.jsx'
import TimeRangeSlider from '../../components/TimeRangeSlider.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import {
  formatMinutes,
  MAX_STUDENTS_LIMIT,
  MIN_DURATION,
  MIN_GROUP_SIZE,
  MODALITIES,
  needsAddress,
  needsMeetingUrl,
  toMinutes,
  validateDraft,
  weekdayPlural,
} from '../../utils/windows.js'
import './WindowForm.css'

// Class components no tienen useId: un contador de módulo, igual que FormField.
let nextFormId = 0

/**
 * Una ventana en modo edición, adentro de su tarjeta. Es controlado: el
 * borrador vive en DayWindowsDialog, que es quien sabe si se está editando
 * una ventana existente o creando una.
 *
 * Los errores se muestran recién después del primer intento de guardar
 * (`showErrors`): nadie quiere un formulario que arranca en rojo.
 *
 * El horario se elige con el mismo slider del filtro del alumno, de a media
 * hora: así el inicio y el fin siempre caen en :00/:30 y nunca quedan al
 * revés. La duración y el precio son texto libre, porque son cualquier
 * número (una clase de 45 min, $ 12.500).
 */
class WindowForm extends Component {
  constructor(props) {
    super(props)
    this.idPrefix = `window-form-${++nextFormId}`
  }

  fieldId(name) {
    return `${this.idPrefix}-${name}`
  }

  update(changes) {
    this.props.onChange({ ...this.props.draft, ...changes })
  }

  handleField = (name) => (event) => {
    this.update({ [name]: event.target.value })
  }

  handleRange = (start, end) => {
    this.update({ start, end })
  }

  handleModality = (modality) => () => {
    this.update({ modality })
  }

  handleGroup = (group) => () => {
    this.update({ group })
  }

  handleRepeat = (event) => {
    this.props.onToggleRepeat(event.target.checked)
  }

  handleSubmit = (event) => {
    event.preventDefault()
    this.props.onSubmit()
  }

  renderError(errors, name) {
    if (!this.props.showErrors || !errors[name]) return null
    return (
      <span className="window-form-error" id={this.fieldId(`${name}-error`)} role="alert">
        {errors[name]}
      </span>
    )
  }

  /** Props de accesibilidad de un campo que puede tener error. */
  invalidProps(errors, name) {
    const invalid = this.props.showErrors && Boolean(errors[name])
    return {
      'aria-invalid': invalid,
      'aria-describedby': invalid ? this.fieldId(`${name}-error`) : undefined,
    }
  }

  renderSubject(errors) {
    const { draft, subjects, saving } = this.props
    return (
      <div className="window-form-field">
        <label className="window-form-label" htmlFor={this.fieldId('subject')}>
          Materia
        </label>
        <select
          id={this.fieldId('subject')}
          className="window-form-select"
          value={draft.subjectId}
          onChange={this.handleField('subjectId')}
          disabled={saving}
          {...this.invalidProps(errors, 'subjectId')}
        >
          <option value="">Elegí una materia</option>
          {subjects.map((subject) => (
            <option key={subject.id} value={subject.id}>
              {subject.name}
            </option>
          ))}
        </select>
        {this.renderError(errors, 'subjectId')}
      </div>
    )
  }

  renderTimes() {
    const { draft, saving } = this.props
    return (
      <fieldset className="window-form-fieldset">
        <legend className="window-form-label">Horario</legend>
        <TimeRangeSlider
          fromTime={draft.start}
          toTime={draft.end}
          step={30}
          emptyAtEnds={false}
          onChange={this.handleRange}
          disabled={saving}
        />
      </fieldset>
    )
  }

  /** Duración y precio: dos números que se tipean, uno al lado del otro. */
  renderNumbers(errors) {
    const { draft, saving } = this.props
    const largo = toMinutes(draft.end) - toMinutes(draft.start)

    return (
      <div className="window-form-row">
        <div className="window-form-field">
          <label className="window-form-label" htmlFor={this.fieldId('duration')}>
            Cada clase dura
          </label>
          <div className="window-form-affix">
            <input
              id={this.fieldId('duration')}
              className="window-form-input"
              type="text"
              inputMode="numeric"
              placeholder="60"
              value={draft.durationMinutes}
              onChange={this.handleField('durationMinutes')}
              disabled={saving}
              {...this.invalidProps(errors, 'durationMinutes')}
            />
            <span className="window-form-suffix">min</span>
          </div>
          {this.renderError(errors, 'durationMinutes') || (
            <span className="window-form-hint">
              Mínimo {MIN_DURATION} min. El horario dura {formatMinutes(largo)}.
            </span>
          )}
        </div>
        <div className="window-form-field">
          <label className="window-form-label" htmlFor={this.fieldId('price')}>
            Precio por clase
          </label>
          <div className="window-form-affix">
            <span className="window-form-prefix">$</span>
            <input
              id={this.fieldId('price')}
              className="window-form-input has-prefix"
              type="text"
              inputMode="numeric"
              placeholder="15.000"
              value={draft.price}
              onChange={this.handleField('price')}
              disabled={saving}
              {...this.invalidProps(errors, 'price')}
            />
          </div>
          {this.renderError(errors, 'price') || (
            <span className="window-form-hint">
              {draft.group ? 'Lo paga cada alumno. ' : ''}0 si es sin cargo.
            </span>
          )}
        </div>
      </div>
    )
  }

  /**
   * Botones que se comportan como radios (aria-pressed), igual que los chips
   * de materias: son tres opciones, se ven todas y en el teléfono un toque
   * alcanza.
   */
  renderModality() {
    const { draft, saving } = this.props
    return (
      <fieldset className="window-form-fieldset">
        <legend className="window-form-label">Modalidad</legend>
        <div className="window-form-segmented">
          {MODALITIES.map((item) => (
            <button
              key={item.key}
              type="button"
              className={`subject-chip ${draft.modality === item.key ? 'selected' : ''}`}
              aria-pressed={draft.modality === item.key}
              onClick={this.handleModality(item.key)}
              disabled={saving}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
    )
  }

  renderLocation(errors) {
    const { draft, saving } = this.props
    return (
      <>
        {needsMeetingUrl(draft.modality) ? (
          <div className="window-form-field">
            <label className="window-form-label" htmlFor={this.fieldId('url')}>
              Link de la videollamada
            </label>
            <input
              id={this.fieldId('url')}
              className="window-form-input"
              type="url"
              inputMode="url"
              placeholder="https://meet.google.com/..."
              value={draft.meetingUrl}
              onChange={this.handleField('meetingUrl')}
              disabled={saving}
              {...this.invalidProps(errors, 'meetingUrl')}
            />
            {this.renderError(errors, 'meetingUrl')}
            <span className="window-form-hint">Solo lo ven los alumnos que reservan.</span>
          </div>
        ) : null}
        {needsAddress(draft.modality) ? (
          <div className="window-form-field">
            <label className="window-form-label" htmlFor={this.fieldId('address')}>
              Dirección
            </label>
            <input
              id={this.fieldId('address')}
              className="window-form-input"
              type="text"
              placeholder="Av. Alicia Moreau de Justo 1300, aula 3"
              maxLength={200}
              value={draft.address}
              onChange={this.handleField('address')}
              disabled={saving}
              {...this.invalidProps(errors, 'address')}
            />
            {this.renderError(errors, 'address')}
          </div>
        ) : null}
      </>
    )
  }

  renderCapacity(errors) {
    const { draft, saving } = this.props
    return (
      <fieldset className="window-form-fieldset">
        <legend className="window-form-label">Alumnos por clase</legend>
        <div className="window-form-capacity">
          <div className="window-form-segmented">
            <button
              type="button"
              className={`subject-chip ${draft.group ? '' : 'selected'}`}
              aria-pressed={!draft.group}
              onClick={this.handleGroup(false)}
              disabled={saving}
            >
              Individual
            </button>
            <button
              type="button"
              className={`subject-chip ${draft.group ? 'selected' : ''}`}
              aria-pressed={draft.group}
              onClick={this.handleGroup(true)}
              disabled={saving}
            >
              Grupal
            </button>
          </div>
          {draft.group ? (
            <div className="window-form-inline">
              <label htmlFor={this.fieldId('size')}>Máximo</label>
              <input
                id={this.fieldId('size')}
                className="window-form-input window-form-number"
                type="number"
                inputMode="numeric"
                min={MIN_GROUP_SIZE}
                max={MAX_STUDENTS_LIMIT}
                value={draft.groupSize}
                onChange={this.handleField('groupSize')}
                disabled={saving}
                {...this.invalidProps(errors, 'groupSize')}
              />
              <span>alumnos</span>
            </div>
          ) : null}
        </div>
        {this.renderError(errors, 'groupSize')}
      </fieldset>
    )
  }

  render() {
    const { draft, saving, serverError, isNew, originalRepeats, iso, onCancel } = this.props
    const errors = validateDraft(draft)

    return (
      <form className="window-form" onSubmit={this.handleSubmit} noValidate>
        <h3 className="window-form-title">{isNew ? 'Nueva clase' : 'Editar clase'}</h3>

        {this.renderSubject(errors)}
        {this.renderTimes()}
        {this.renderNumbers(errors)}
        {this.renderModality()}
        {this.renderLocation(errors)}
        {this.renderCapacity(errors)}

        <label className="window-form-check">
          <input
            type="checkbox"
            checked={draft.repeatsWeekly}
            onChange={this.handleRepeat}
            disabled={saving}
          />
          <span>Repetir todos los {weekdayPlural(iso)}</span>
        </label>
        {/* Editar una semanal cambia la serie entera: se dice antes de
            guardar, no después. */}
        {!isNew && originalRepeats && draft.repeatsWeekly ? (
          <p className="window-form-hint">Los cambios valen para todas las semanas.</p>
        ) : null}
        {!isNew && originalRepeats && !draft.repeatsWeekly ? (
          <p className="window-form-hint">
            Va a quedar solo este día: deja de repetirse las demás semanas.
          </p>
        ) : null}

        {serverError ? <Banner type="danger">{serverError}</Banner> : null}

        <div className="window-form-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? <SpinnerIcon className="spin" /> : null}
            {saving ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      </form>
    )
  }
}

WindowForm.defaultProps = {
  subjects: [],
  saving: false,
  showErrors: false,
  serverError: null,
  isNew: true,
  originalRepeats: false,
}

export default WindowForm

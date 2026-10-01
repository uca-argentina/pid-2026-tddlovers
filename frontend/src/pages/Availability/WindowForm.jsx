import { Component } from 'react'
import { Link } from 'react-router-dom'
import Banner from '../../components/Banner.jsx'
import TimeRangeSlider from '../../components/TimeRangeSlider.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import {
  formatHourlyRate,
  MIN_CLASS_MINUTES,
  rateModalities,
  ratesForModality,
} from '../../utils/rates.js'
import {
  formatMinutes,
  MAX_STUDENTS_LIMIT,
  MIN_GROUP_SIZE,
  MODALITIES,
  modalityPlural,
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
 * revés.
 *
 * No hay materia, duración ni precio: la ventana es "cuándo estoy y cómo".
 * El alumno elige la materia (entre las que el docente tarifó en esa
 * modalidad) y cuánto dura la clase, y paga según la tarifa por hora. Por eso
 * abajo de la modalidad se muestra qué va a poder elegir el alumno — o que no
 * hay nada, si el docente no tiene tarifas para esa modalidad.
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

  renderTimes() {
    const { draft, saving } = this.props
    const largo = toMinutes(draft.end) - toMinutes(draft.start)
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
        <span className="window-form-hint">
          {formatMinutes(largo)} disponibles. Cada alumno elige cuánto dura su clase, desde{' '}
          {MIN_CLASS_MINUTES} min.
        </span>
      </fieldset>
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
        {this.renderOffer()}
      </fieldset>
    )
  }

  /**
   * Qué va a poder reservar el alumno con esta modalidad. Se ve siempre, no
   * solo al intentar guardar: sin tarifas para la modalidad, el docente tiene
   * que saberlo antes de completar todo lo demás.
   */
  renderOffer() {
    const { draft, rates } = this.props
    const ofrecidas = ratesForModality(rates, draft.modality)

    if (ofrecidas.length === 0) {
      return (
        <p className="window-form-error" id={this.fieldId('modality-error')}>
          No tenés tarifas para clases {modalityPlural(draft.modality)}.{' '}
          <Link className="auth-link" to="/perfil">
            Cargalas en tu perfil
          </Link>
          .
        </p>
      )
    }

    const lista = ofrecidas
      .map((rate) => `${rate.subjectName} (${formatHourlyRate(rate.hourlyRateCents)})`)
      .join(', ')
    return <span className="window-form-hint">Los alumnos eligen entre: {lista}.</span>
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
        {/* Dos niveles a propósito: la localidad la ve cualquier alumno para
            decidir si le queda cerca; la dirección exacta, solo el que
            reservó (igual que el link). */}
        {needsAddress(draft.modality) ? (
          <div className="window-form-field">
            <label className="window-form-label" htmlFor={this.fieldId('locality')}>
              Localidad
            </label>
            <input
              id={this.fieldId('locality')}
              className="window-form-input"
              type="text"
              placeholder="Palermo, CABA"
              maxLength={100}
              value={draft.locality}
              onChange={this.handleField('locality')}
              disabled={saving}
              {...this.invalidProps(errors, 'locality')}
            />
            {this.renderError(errors, 'locality') || (
              <span className="window-form-hint">La ven todos los alumnos, antes de reservar.</span>
            )}
          </div>
        ) : null}
        {needsAddress(draft.modality) ? (
          <div className="window-form-field">
            <label className="window-form-label" htmlFor={this.fieldId('address')}>
              Dirección exacta
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
            {this.renderError(errors, 'address') || (
              <span className="window-form-hint">Solo la ven los alumnos que reservan.</span>
            )}
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
    const errors = validateDraft(draft, { rateModalities: rateModalities(this.props.rates) })

    return (
      <form className="window-form" onSubmit={this.handleSubmit} noValidate>
        <h3 className="window-form-title">{isNew ? 'Nuevo horario' : 'Editar horario'}</h3>

        {this.renderTimes()}
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
  rates: [],
  saving: false,
  showErrors: false,
  serverError: null,
  isNew: true,
  originalRepeats: false,
}

export default WindowForm

import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { bookLesson } from '../../api/client.js'
import { formatDayLongWithYear, fromISODate } from '../../utils/calendar.js'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatEnrolled, toMinutes } from '../../utils/booking.js'
import {
  classPriceCents,
  durationOptions,
  formatHourlyRate,
  formatMoney,
} from '../../utils/rates.js'
import {
  capacityLabel,
  formatMinutes,
  minutesToTime,
  modalityLabel,
  needsAddress,
  needsMeetingUrl,
} from '../../utils/windows.js'
import './BookingDialog.css'

// La duración con la que arranca el selector al elegir un horario: una hora
// es lo más común, y si no entra, lo más largo que entre.
const DEFAULT_MINUTES = 60

/**
 * El paso final: armar la clase y confirmar. El alumno elige tres cosas:
 *   - la materia, entre las que el docente tiene tarifa en esta modalidad;
 *   - a qué hora arranca (:00/:30), o sumarse a una grupal ya armada;
 *   - cuánto dura, de a 5 minutos, hasta lo que entre.
 * La modalidad y el lugar ya vienen de la ventana. El precio se muestra antes
 * de confirmar (tarifa × duración); el que vale es el que calcula el backend,
 * con la misma cuenta.
 *
 * Sumarse a una grupal es tomar la MISMA clase: su materia, su hora y su
 * duración vienen fijas, así que elegir una grupal completa los tres pasos
 * de una.
 *
 * Acá NO se vuelve a calcular qué está libre: la tarjeta ya trae los inicios
 * posibles con su duración máxima (del backend, recortados por las clases
 * propias en annotateClashes). Una segunda cuenta sería una segunda verdad.
 */
class BookingDialog extends Component {
  constructor(props) {
    super(props)
    const { subjects, starts, groups } = props.card
    // Si hay una sola materia, o un solo horario posible, no tiene sentido
    // hacerlos elegir. La duración sí queda a la vista para cambiarla.
    const libres = starts.filter((option) => !option.blocked)
    const unico =
      libres.length === 1 && !groups.some((group) => !group.blocked) ? libres[0] : null
    this.state = {
      subjectId: subjects.length === 1 ? subjects[0].id : null,
      groupStart: null,
      start: unico ? unico.start : null,
      minutes: unico ? Math.min(DEFAULT_MINUTES, unico.maxMinutes) : null,
      saving: false,
      error: null,
    }
  }

  getSubject(subjectId = this.state.subjectId) {
    return this.props.card.subjects.find((subject) => String(subject.id) === String(subjectId))
  }

  getGroup() {
    const { groupStart } = this.state
    if (groupStart === null) return null
    return this.props.card.groups.find((group) => group.start === groupStart) || null
  }

  getStartOption() {
    return this.props.card.starts.find((option) => option.start === this.state.start) || null
  }

  /**
   * La clase que quedó armada: { start, end, minutes, subjectId, joining }, o
   * null si falta elegir la hora o la duración. La materia puede faltar
   * todavía (se pide aparte).
   */
  getSelection() {
    const group = this.getGroup()
    if (group) {
      return {
        start: group.start,
        end: group.end,
        minutes: toMinutes(group.end) - toMinutes(group.start),
        subjectId: group.subjectId,
        joining: true,
      }
    }
    const { start, minutes, subjectId } = this.state
    if (start === null || minutes === null) return null
    return {
      start,
      end: minutesToTime(toMinutes(start) + minutes),
      minutes,
      subjectId,
      joining: false,
    }
  }

  getPriceCents(selection) {
    const subject = selection && this.getSubject(selection.subjectId)
    if (!subject) return null
    return classPriceCents(subject.hourlyRateCents, selection.minutes)
  }

  handleSubject = (subjectId) => () => {
    this.setState((prev) => {
      // Una grupal es de una materia: cambiar de materia la suelta.
      const group = this.props.card.groups.find((item) => item.start === prev.groupStart)
      const sigue = group && String(group.subjectId) === String(subjectId)
      return { subjectId, groupStart: sigue ? prev.groupStart : null, error: null }
    })
  }

  handleGroup = (group) => () => {
    this.setState({
      groupStart: group.start,
      subjectId: group.subjectId,
      start: null,
      error: null,
    })
  }

  handleStart = (option) => () => {
    this.setState((prev) => {
      // Se respeta la duración que ya había elegido, si entra en el horario nuevo.
      const pedida = prev.minutes ?? DEFAULT_MINUTES
      const minutes = Math.min(pedida, option.maxMinutes)
      return { start: option.start, minutes, groupStart: null, error: null }
    })
  }

  handleMinutes = (event) => {
    this.setState({ minutes: Number(event.target.value), error: null })
  }

  handleConfirm = () => {
    const { card, onBooked } = this.props
    const { saving } = this.state
    const selection = this.getSelection()
    const subject = selection && this.getSubject(selection.subjectId)
    if (!selection || !subject || saving) return

    this.setState({ saving: true, error: null })

    bookLesson({
      windowId: card.windowId,
      date: card.date,
      startTime: selection.start,
      subjectId: subject.id,
      durationMinutes: selection.minutes,
    })
      .then(() => onBooked({ subjectName: subject.name, teacherName: card.teacherName }))
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo reservar la clase. Probá de nuevo.',
        })
      })
  }

  renderPrivateNote() {
    const { modality } = this.props.card
    const queSeVe = [
      needsMeetingUrl(modality) ? 'El link de la videollamada' : null,
      needsAddress(modality) ? 'la dirección exacta' : null,
    ].filter(Boolean)
    if (queSeVe.length === 0) return null

    const sujeto = queSeVe.join(' y ')
    const verbo = queSeVe.length > 1 ? 'te aparecen' : 'te aparece'
    return (
      <p className="booking-dialog-note">
        {sujeto.charAt(0).toUpperCase() + sujeto.slice(1)} {verbo} en tu calendario cuando reserves.
      </p>
    )
  }

  renderSubjects() {
    const { subjects } = this.props.card
    const { saving } = this.state
    const selection = this.getSelection()
    const elegida = selection?.joining ? selection.subjectId : this.state.subjectId

    return (
      <fieldset className="booking-dialog-slots">
        <legend>Materia</legend>
        <div className="booking-dialog-subjects">
          {subjects.map((subject) => {
            const activa = String(subject.id) === String(elegida)
            return (
              <button
                key={subject.id}
                type="button"
                className={`booking-subject ${activa ? 'is-selected' : ''}`}
                aria-pressed={activa}
                onClick={this.handleSubject(subject.id)}
                disabled={saving}
              >
                <span className="booking-subject-name">{subject.name}</span>
                <span className="booking-subject-rate">{formatHourlyRate(subject.hourlyRateCents)}</span>
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  /** Por qué una grupal no se puede tomar, para el lector de pantalla. */
  describeGroup(group) {
    const base = `${group.subjectName}, ${group.start} a ${group.end}, ${formatEnrolled(
      group.enrolled,
      this.props.card.maxStudents,
    )}`
    if (group.joined) return `${base}, ya estás anotado`
    if (group.blocked) return `${base}, ya tenés otra clase`
    return base
  }

  renderGroups() {
    const { card } = this.props
    if (card.groups.length === 0) return null

    return (
      <fieldset className="booking-dialog-slots">
        <legend>Sumate a una clase grupal</legend>
        <div className="booking-dialog-slot-list">
          {card.groups.map((group) => {
            const elegida = group.start === this.state.groupStart
            return (
              <button
                key={group.start}
                type="button"
                className={`booking-slot is-group ${elegida ? 'is-selected' : ''}`}
                aria-pressed={elegida}
                aria-label={this.describeGroup(group)}
                onClick={this.handleGroup(group)}
                disabled={group.blocked || this.state.saving}
              >
                <span className="booking-slot-time">{formatRangeLabel(group.start, group.end)}</span>
                <span className="booking-slot-note">
                  {group.subjectName} ·{' '}
                  {group.joined ? 'ya estás anotado' : formatEnrolled(group.enrolled, card.maxStudents)}
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  renderStarts() {
    const { card } = this.props
    if (card.starts.length === 0) return null

    return (
      <fieldset className="booking-dialog-slots">
        <legend>{card.groups.length > 0 ? 'O empezá una nueva a las' : '¿A qué hora arranca?'}</legend>
        <div className="booking-dialog-slot-list is-compact">
          {card.starts.map((option) => {
            const elegido = option.start === this.state.start
            return (
              <button
                key={option.start}
                type="button"
                className={`booking-slot ${elegido ? 'is-selected' : ''}`}
                aria-pressed={elegido}
                aria-label={
                  option.blocked ? `${option.start}, ya tenés otra clase` : option.start
                }
                onClick={this.handleStart(option)}
                disabled={option.blocked || this.state.saving}
              >
                <span className="booking-slot-time">{option.start}</span>
              </button>
            )
          })}
        </div>
      </fieldset>
    )
  }

  /** Solo con un horario nuevo elegido: la grupal ya trae su duración. */
  renderDuration() {
    const option = this.getStartOption()
    if (!option || this.state.groupStart !== null) return null

    return (
      <div className="booking-dialog-duration-field">
        <label htmlFor="booking-dialog-minutes">¿Cuánto dura?</label>
        <select
          id="booking-dialog-minutes"
          className="booking-dialog-select"
          value={this.state.minutes ?? ''}
          onChange={this.handleMinutes}
          disabled={this.state.saving}
        >
          {durationOptions(option.maxMinutes).map((minutes) => (
            <option key={minutes} value={minutes}>
              {formatMinutes(minutes)} (hasta las {minutesToTime(toMinutes(option.start) + minutes)})
            </option>
          ))}
        </select>
      </div>
    )
  }

  renderSummary() {
    const selection = this.getSelection()
    const subject = selection && this.getSubject(selection.subjectId)

    if (!selection) {
      const falta = this.state.subjectId === null ? 'la materia y a qué hora' : 'a qué hora'
      return <p className="booking-dialog-hint">Elegí {falta} querés la clase.</p>
    }
    if (!subject) {
      return <p className="booking-dialog-hint">Elegí la materia para ver el precio.</p>
    }

    return (
      <div className="booking-dialog-pick">
        <p>
          {formatRangeLabel(selection.start, selection.end)}
          <span className="booking-dialog-duration">
            {` · ${formatMinutes(selection.minutes)} · ${subject.name}`}
            {selection.joining ? ' · te sumás a una clase grupal' : ''}
          </span>
        </p>
        <p className="booking-dialog-price">
          {formatMoney(this.getPriceCents(selection))}
          {this.props.card.maxStudents > 1 && subject.hourlyRateCents > 0 ? (
            <span className="booking-dialog-duration"> por alumno</span>
          ) : null}
        </p>
      </div>
    )
  }

  render() {
    const { card, onClose } = this.props
    const { saving, error } = this.state
    const selection = this.getSelection()
    const listo = Boolean(selection && this.getSubject(selection.subjectId))

    return (
      <Modal title="Reservar clase" onClose={onClose}>
        <div className="booking-dialog">
          <dl className="booking-dialog-details">
            <div>
              <dt>Docente</dt>
              <dd>{card.teacherName}</dd>
            </div>
            <div>
              <dt>Día</dt>
              <dd>{formatDayLongWithYear(fromISODate(card.date))}</dd>
            </div>
            <div>
              <dt>Horario</dt>
              <dd>{formatRangeLabel(card.start, card.end)}</dd>
            </div>
            <div>
              <dt>Modalidad</dt>
              <dd>{modalityLabel(card.modality)}</dd>
            </div>
            <div>
              <dt>Cupo</dt>
              <dd>{capacityLabel(card.maxStudents)}</dd>
            </div>
            {needsAddress(card.modality) && card.locality ? (
              <div className="booking-dialog-wide">
                <dt>Localidad</dt>
                <dd>{card.locality}</dd>
              </div>
            ) : null}
          </dl>

          {/* Ni el link ni la dirección exacta viajan en la disponibilidad: se
              los lleva el que reserva, en su calendario. */}
          {this.renderPrivateNote()}

          {this.renderSubjects()}
          {this.renderGroups()}
          {this.renderStarts()}
          {this.renderDuration()}

          {this.renderSummary()}

          {error ? <Banner type="danger">{error}</Banner> : null}

          <div className="booking-dialog-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              Cancelar
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.handleConfirm}
              disabled={!listo || saving}
            >
              {saving ? <SpinnerIcon className="spin" /> : null}
              {saving ? 'Reservando...' : 'Confirmar reserva'}
            </button>
          </div>
        </div>
      </Modal>
    )
  }
}

export default BookingDialog

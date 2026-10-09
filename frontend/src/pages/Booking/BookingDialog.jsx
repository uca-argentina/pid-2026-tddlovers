import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import DurationSlider from '../../components/DurationSlider.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { bookLesson, rescheduleLesson } from '../../api/client.js'
import { formatDayLongWithYear, fromISODate } from '../../utils/calendar.js'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatEnrolled, toMinutes } from '../../utils/booking.js'
import {
  CLASS_MINUTES_STEP,
  MIN_CLASS_MINUTES,
  classPriceCents,
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
import {
  activePacksWith,
  classesLabel,
  formatPackDate,
  maxTokensFor,
  packClassesLabel,
  usablePackFor,
} from '../../utils/packs.js'
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
 * Si el alumno tiene un paquete con este docente que sirve para ese día, elige
 * cuántas clases del paquete usa (de entrada, todas las que entran en la
 * duración). Cada una cubre la duración fija del paquete; lo que se pase se
 * paga aparte con la tarifa ("1 clase de 1 h + 30 min a pagar"). Materia,
 * horario y duración se eligen igual, y al reprogramar también.
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
      // Cuántas clases del paquete usa. null = "todas las que entran", que
      // es lo que conviene de entrada y se acomoda solo si cambia la duración.
      packTokens: null,
      saving: false,
      error: null,
    }
  }

  getUsablePack() {
    const { packs, card } = this.props
    return usablePackFor(packs, card.teacherId, card.date)
  }

  /** Cuántas clases del paquete entran como mucho en la clase elegida. */
  getMaxTokens(selection = this.getSelection()) {
    return maxTokensFor(this.getUsablePack(), selection?.minutes)
  }

  /** Cuántas usa: lo que eligió, recortado a lo que entra ahora. */
  getTokens(selection = this.getSelection()) {
    const max = this.getMaxTokens(selection)
    const { packTokens } = this.state
    return packTokens === null ? max : Math.min(packTokens, max)
  }

  /** Lo que se paga aparte: la duración menos lo que cubre el paquete. */
  getExtraMinutes(selection) {
    const pack = this.getUsablePack()
    const cubiertos = pack ? this.getTokens(selection) * pack.classMinutes : 0
    return Math.max(selection.minutes - cubiertos, 0)
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

  /** Lo que se paga: la clase entera, o solo lo que se pasa del paquete. */
  getPriceCents(selection) {
    const subject = selection && this.getSubject(selection.subjectId)
    if (!subject) return null
    return classPriceCents(subject.hourlyRateCents, this.getExtraMinutes(selection))
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

  handleMinutes = (minutes) => {
    this.setState({ minutes, error: null })
  }

  handleTokens = (delta) => () => {
    const actual = this.getTokens()
    const max = this.getMaxTokens()
    this.setState({ packTokens: Math.max(0, Math.min(actual + delta, max)), error: null })
  }

  handleConfirm = () => {
    const { card, onBooked } = this.props
    const { saving } = this.state
    const selection = this.getSelection()
    const subject = selection && this.getSubject(selection.subjectId)
    if (!selection || !subject || saving) return

    this.setState({ saving: true, error: null })

    const { rescheduleOf } = this.props
    const pedido = {
      windowId: card.windowId,
      date: card.date,
      startTime: selection.start,
      subjectId: subject.id,
      durationMinutes: selection.minutes,
    }
    // Reprogramar manda lo mismo que reservar, salvo la materia: la pone el
    // backend, es la de la clase vieja (la tarjeta ya viene recortada a esa).
    const tokens = this.getTokens(selection)
    const usedPack = tokens > 0
    if (usedPack) {
      pedido.packId = this.getUsablePack().id
      pedido.packTokens = tokens
    }
    const guardar = rescheduleOf ? rescheduleLesson(rescheduleOf.id, pedido) : bookLesson(pedido)

    guardar
      .then(() =>
        onBooked({
          subjectName: subject.name,
          teacherName: card.teacherName,
          rescheduled: Boolean(rescheduleOf),
          usedPack,
        }),
      )
      .catch((error) => {
        this.setState({
          saving: false,
          error: error.message || 'No se pudo reservar la clase. Probá de nuevo.',
        })
      })
  }

  renderConfirmLabel() {
    const { saving } = this.state
    if (this.props.rescheduleOf) return saving ? 'Reprogramando...' : 'Pedir nuevo horario'
    return saving ? 'Reservando...' : 'Confirmar reserva'
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

    const { minutes } = this.state
    const hasta = minutesToTime(toMinutes(option.start) + minutes)

    return (
      <div className="booking-dialog-duration-field">
        <label htmlFor="booking-dialog-minutes">¿Cuánto dura?</label>
        <DurationSlider
          id="booking-dialog-minutes"
          value={minutes}
          min={MIN_CLASS_MINUTES}
          max={option.maxMinutes}
          step={CLASS_MINUTES_STEP}
          onChange={this.handleMinutes}
          disabled={this.state.saving}
          valueLabel={`${formatMinutes(minutes)} · ${formatRangeLabel(option.start, hasta)}`}
          minLabel={formatMinutes(MIN_CLASS_MINUTES)}
          maxLabel={formatMinutes(option.maxMinutes)}
        />
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
        {this.getTokens(selection) > 0 && this.getExtraMinutes(selection) === 0 ? (
          <p className="booking-dialog-price">Incluida en tu paquete</p>
        ) : (
          <p className="booking-dialog-price">
            {formatMoney(this.getPriceCents(selection))}
            {this.props.card.maxStudents > 1 && subject.hourlyRateCents > 0 ? (
              <span className="booking-dialog-duration"> por alumno</span>
            ) : null}
            {this.getTokens(selection) > 0 ? (
              <span className="booking-dialog-duration">
                {` + ${classesLabel(this.getTokens(selection))} del paquete`}
              </span>
            ) : null}
          </p>
        )}
      </div>
    )
  }

  /**
   * Cuántas clases del paquete usa, y qué cubren. Si tiene un paquete vigente
   * con este docente pero no sirve para este día (vence antes, o ya reservó
   * todas las que le quedan), se explica en vez de esconderlo.
   */
  renderPack() {
    const { packs, card } = this.props
    const usable = this.getUsablePack()

    if (!usable) {
      const activos = activePacksWith(packs, card.teacherId)
      if (activos.length === 0) return null
      const vencenAntes = activos.every((pack) => card.date > pack.expiresOn)
      return (
        <p className="booking-dialog-pack-note">
          {vencenAntes
            ? 'Tu paquete con este docente vence antes de este día: esta clase se paga aparte.'
            : 'Ya reservaste todas las clases de tu paquete con este docente: esta se paga aparte.'}
        </p>
      )
    }

    const selection = this.getSelection()
    const disponible = `${packClassesLabel(usable.available, usable.classMinutes)} para reservar · vence el ${formatPackDate(usable.expiresOn)}`

    // Sin duración elegida todavía no se sabe cuántas entran.
    if (!selection) {
      return (
        <div className="booking-dialog-pack">
          <span>
            Tu paquete
            <span className="booking-dialog-pack-detail">Te quedan {disponible}</span>
          </span>
        </div>
      )
    }

    const tokens = this.getTokens(selection)
    const max = this.getMaxTokens(selection)
    const extra = this.getExtraMinutes(selection)
    const { saving } = this.state

    let detalle
    if (max === 0) {
      detalle = `Cada clase del paquete dura ${formatMinutes(usable.classMinutes)}: alargá la clase para usarla.`
    } else if (tokens === 0) {
      detalle = 'No usás el paquete: pagás la clase entera.'
    } else if (extra === 0) {
      detalle = `Cubre toda la clase (${formatMinutes(selection.minutes)}).`
    } else {
      detalle = `Cubre ${formatMinutes(tokens * usable.classMinutes)} · pagás aparte ${formatMinutes(extra)}.`
    }

    return (
      <div className="booking-dialog-pack">
        <span className="booking-dialog-pack-text">
          Clases de tu paquete ({formatMinutes(usable.classMinutes)} c/u)
          <span className="booking-dialog-pack-detail">{detalle}</span>
          <span className="booking-dialog-pack-detail">Te quedan {disponible}</span>
        </span>
        <span className="booking-dialog-stepper" role="group" aria-label="Clases del paquete a usar">
          <button
            type="button"
            onClick={this.handleTokens(-1)}
            disabled={saving || tokens === 0}
            aria-label="Usar una clase menos del paquete"
          >
            −
          </button>
          <output aria-live="polite" aria-label={`Usás ${classesLabel(tokens)} del paquete`}>
            {tokens}
          </output>
          <button
            type="button"
            onClick={this.handleTokens(1)}
            disabled={saving || tokens >= max}
            aria-label="Usar una clase más del paquete"
          >
            +
          </button>
        </span>
      </div>
    )
  }

  render() {
    const { card, onClose } = this.props
    const { saving, error } = this.state
    const selection = this.getSelection()
    const listo = Boolean(selection && this.getSubject(selection.subjectId))

    return (
      <Modal title={this.props.rescheduleOf ? 'Reprogramar clase' : 'Reservar clase'} onClose={onClose}>
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

          {this.renderPack()}
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
              {this.renderConfirmLabel()}
            </button>
          </div>
        </div>
      </Modal>
    )
  }
}

BookingDialog.defaultProps = {
  packs: [],
  rescheduleOf: null,
}

export default BookingDialog

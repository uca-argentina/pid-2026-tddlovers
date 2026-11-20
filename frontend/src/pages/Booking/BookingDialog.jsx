import { Component } from 'react'
import Modal from '../../components/Modal.jsx'
import Banner from '../../components/Banner.jsx'
import DurationSlider from '../../components/DurationSlider.jsx'
import { SpinnerIcon } from '../../components/icons.jsx'
import { createBooking, rescheduleBooking } from '../../api/client.js'
import { formatDayLongWithYear, fromISODate } from '../../utils/calendar.js'
import { formatRangeLabel } from '../../utils/availability.js'
import { formatEnrolled, toMinutes } from '../../utils/booking.js'
import {
  CLASS_MINUTES_STEP,
  MIN_CLASS_MINUTES,
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
  classesLabel,
  formatPackDate,
  packClassesLabel,
  quoteBooking,
  unusablePackReason,
  usablePackFor,
} from '../../utils/packs.js'
import { REWARDS, formatNeuronas, rewardFits, rewardsOffered } from '../../utils/neuronas.js'
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
 * Si el docente acepta canjes y la materia no es gratis, puede usar neuronas en
 * vez del paquete: las dos cosas juntas no van. Un canje que deja de valer
 * (se acortó la clase, se cambió a una materia sin cargo) se deja de aplicar
 * solo.
 *
 * Paquete, canje y precio salen de UNA cuenta por render (quoteBooking en
 * utils/packs.js), que se les pasa a las partes que la muestran.
 *
 * Acá NO se vuelve a calcular qué está libre: la tarjeta ya trae los inicios
 * que este alumno puede tomar con su duración máxima (`starts`, recortados
 * por el backend con sus clases propias) y las grupales a las que se puede
 * sumar (`groups`). Una segunda cuenta sería una segunda verdad.
 *
 * Rol: alumno. Lo abre BookingBoard (renderDialog) al tocar "Reservar" en una
 * tarjeta.
 *
 * Props (todas de BookingBoard):
 *   - card: la tarjeta elegida, una fila de GET /api/availability: windowId,
 *     date, teacherId, teacherName, teacherAcceptsRewards, modality,
 *     maxStudents, subjects [{id, name, hourlyRateCents}], starts [{start,
 *     maxMinutes}] y groups [{start, end, subjectId, subjectName, enrolled,
 *     maxStudents}].
 *   - rescheduleOf: la clase que se reprograma (GET /api/bookings/:id), o null.
 *   - packs: paquetes del alumno (GET /api/packs/mine), ya ajustados por
 *     BookingBoard si se reprograma (packsForReschedule).
 *   - neuronasBalance: saldo de GET /api/neuronas.
 *   - onClose(): cerrar sin reservar.
 *   - onBooked({ date, subjectName, teacherName, rescheduled, usedPack,
 *     usedReward }): se llama cuando el backend confirmó la reserva.
 *
 * Datos: al confirmar, createBooking → POST /api/bookings, o rescheduleBooking →
 * POST /api/bookings/:id/reschedule si hay rescheduleOf.
 *
 * Estado (todo lo elige el alumno en el modal):
 *   - subjectId: materia elegida; groupStart: inicio de la grupal a la que se
 *     suma (o null); start/minutes: inicio y duración de una clase nueva.
 *   - packTokens: clases del paquete a usar (null = todas las que entran).
 *   - rewardType: canje de neuronas elegido (clave de REWARDS) o null.
 *   - saving/error: del pedido de confirmación.
 */
class BookingDialog extends Component {
  constructor(props) {
    super(props)
    const { subjects, starts, groups } = props.card
    // Si hay una sola materia, o un solo horario posible, no tiene sentido
    // hacerlos elegir. La duración sí queda a la vista para cambiarla.
    const unico = starts.length === 1 && groups.length === 0 ? starts[0] : null
    this.state = {
      subjectId: subjects.length === 1 ? subjects[0].id : null,
      groupStart: null,
      start: unico ? unico.start : null,
      minutes: unico ? Math.min(DEFAULT_MINUTES, unico.maxMinutes) : null,
      // Cuántas clases del paquete usa. null = "todas las que entran", que
      // es lo que conviene de entrada y se acomoda solo si cambia la duración.
      packTokens: null,
      rewardType: null,
      saving: false,
      error: null,
    }
  }

  /** El paquete del alumno que sirve con este docente ese día (usablePackFor), o null. */
  getUsablePack() {
    const { card } = this.props
    return usablePackFor(this.props.packs, card.teacherId, card.date)
  }

  /** Cuántas neuronas tiene para gastar. Al reprogramar, el canje de la vieja le vuelve. */
  getNeuronas() {
    const { neuronasBalance, rescheduleOf } = this.props
    return neuronasBalance + (rescheduleOf?.rewardNeuronas ?? 0)
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

  /** Paquete, canje y precio de la clase armada (ver quoteBooking). */
  getQuote(selection = this.getSelection()) {
    const subject = selection && this.getSubject(selection.subjectId)
    return quoteBooking({
      hourlyRateCents: subject ? subject.hourlyRateCents : null,
      minutes: selection ? selection.minutes : null,
      pack: this.getUsablePack(),
      packTokens: this.state.packTokens,
      rewardType: this.state.rewardType,
      acceptsRewards: this.props.card.teacherAcceptsRewards,
      balance: this.getNeuronas(),
    })
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
    const { tokens, maxTokens } = this.getQuote()
    this.setState({ packTokens: Math.max(0, Math.min(tokens + delta, maxTokens)), error: null })
  }

  handleReward = (rewardType) => () => {
    this.setState((prev) => ({
      rewardType: prev.rewardType === rewardType ? null : rewardType,
      error: null,
    }))
  }

  /**
   * Arma el pedido con la selección (ventana, fecha, inicio, materia,
   * duración, y si corresponde packId/packTokens o rewardType según
   * getQuote) y lo manda: createBooking → POST /api/bookings, o rescheduleBooking
   * → POST /api/bookings/:id/reschedule. Si sale bien llama a onBooked con el
   * resumen para el cartel; si falla deja el mensaje del backend en `error`.
   */
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
    const { tokens, reward } = this.getQuote(selection)
    const usedPack = tokens > 0
    if (usedPack) {
      pedido.packId = this.getUsablePack().id
      pedido.packTokens = tokens
    }
    if (reward) pedido.rewardType = reward
    const guardar = rescheduleOf ? rescheduleBooking(rescheduleOf.id, pedido) : createBooking(pedido)

    guardar
      .then(() =>
        onBooked({
          // El día va acá y no se lee de afuera: quien abrió el modal no tiene
          // por qué seguir teniendo la tarjeta cuando vuelve la respuesta.
          date: card.date,
          subjectName: subject.name,
          teacherName: card.teacherName,
          rescheduled: Boolean(rescheduleOf),
          usedPack,
          usedReward: Boolean(reward),
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

  /** La grupal, para el lector de pantalla. */
  describeGroup(group) {
    return `${group.subjectName}, ${group.start} a ${group.end}, ${formatEnrolled(
      group.enrolled,
      group.maxStudents,
    )}`
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
                disabled={this.state.saving}
              >
                <span className="booking-slot-time">{formatRangeLabel(group.start, group.end)}</span>
                <span className="booking-slot-note">
                  {group.subjectName} · {formatEnrolled(group.enrolled, group.maxStudents)}
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
                onClick={this.handleStart(option)}
                disabled={this.state.saving}
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

  renderSummary(selection, subject, quote) {
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
        {quote.coveredBy === 'pack' ? (
          <p className="booking-dialog-price">Incluida en tu paquete</p>
        ) : quote.coveredBy === 'reward' ? (
          <p className="booking-dialog-price">
            Cubierta con neuronas
            <span className="booking-dialog-duration">
              {` · usás ${formatNeuronas(REWARDS[quote.reward].cost)}`}
            </span>
          </p>
        ) : (
          <p className="booking-dialog-price">
            {formatMoney(quote.priceCents)}
            {this.props.card.maxStudents > 1 && subject.hourlyRateCents > 0 ? (
              <span className="booking-dialog-duration"> por alumno</span>
            ) : null}
            {quote.tokens > 0 ? (
              <span className="booking-dialog-duration">
                {` + ${classesLabel(quote.tokens)} del paquete`}
              </span>
            ) : null}
            {quote.reward ? (
              <span className="booking-dialog-duration">
                {` + ${formatNeuronas(REWARDS[quote.reward].cost)}`}
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
   * todas las que le quedan), se explica en vez de esconderlo
   * (unusablePackReason, que mira `usable` del backend).
   */
  renderPack(selection, quote) {
    const { card } = this.props
    const usable = this.getUsablePack()

    if (!usable) {
      const motivo = unusablePackReason(this.props.packs, card.teacherId, card.date)
      if (!motivo) return null
      return (
        <p className="booking-dialog-pack-note">
          {motivo === 'expires'
            ? 'Tu paquete con este docente vence antes de este día: esta clase se paga aparte.'
            : 'Ya reservaste todas las clases de tu paquete con este docente: esta clase se paga aparte.'}
        </p>
      )
    }

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

    const { tokens, maxTokens: max, extraMinutes: extra } = quote
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

  /**
   * Los canjes posibles. Se muestran también los que no alcanzan, deshabilitados:
   * así el alumno ve a cuánto está. Si la clase es gratis no hay nada que canjear.
   */
  renderRewards(selection, subject, quote) {
    const { card } = this.props
    if (!subject) return null
    const ofrecidos = rewardsOffered({
      acceptsRewards: card.teacherAcceptsRewards,
      hourlyRateCents: subject.hourlyRateCents,
    })
    if (!ofrecidos) return null

    const neuronas = this.getNeuronas()
    const elegida = quote.reward
    return (
      <div className="booking-dialog-pack booking-dialog-rewards">
        <span className="booking-dialog-pack-text">
          Usar neuronas
          <span className="booking-dialog-pack-detail">
            Tenés {formatNeuronas(neuronas)}. No se combinan con un paquete.
          </span>
        </span>
        <div className="booking-dialog-reward-list">
          {Object.entries(REWARDS).map(([type, reward]) => {
            const activa = type === elegida
            return (
              <button
                key={type}
                type="button"
                className={`booking-slot ${activa ? 'is-selected' : ''}`}
                aria-pressed={activa}
                onClick={this.handleReward(type)}
                disabled={
                  this.state.saving ||
                  neuronas < reward.cost ||
                  !rewardFits(type, selection.minutes)
                }
              >
                <span className="booking-slot-time">{reward.label}</span>
                <span className="booking-slot-note">{formatNeuronas(reward.cost)}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  render() {
    const { card, onClose } = this.props
    const { saving, error } = this.state
    const selection = this.getSelection()
    const subject = selection && this.getSubject(selection.subjectId)
    const quote = this.getQuote(selection)
    const listo = Boolean(subject)

    return (
      // Mientras se envía no se cierra: la reserva va a quedar hecha igual, y
      // el tablero tiene que enterarse para recargar y avisar.
      <Modal
        title={this.props.rescheduleOf ? 'Reprogramar clase' : 'Reservar clase'}
        onClose={onClose}
        closable={!saving}
      >
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

          {this.renderPack(selection, quote)}
          {this.renderRewards(selection, subject, quote)}
          {this.renderSummary(selection, subject, quote)}

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
  neuronasBalance: 0,
  rescheduleOf: null,
}

export default BookingDialog

import { Component } from 'react'
import ClassActions from './ClassActions.jsx'
import FavoriteButton from './FavoriteButton.jsx'
import TurnActions from './TurnActions.jsx'
import { PaperclipIcon } from './icons.jsx'
import { formatRangeLabel } from '../utils/availability.js'
import { formatDayLong, fromISODate } from '../utils/calendar.js'
import { isFavorite } from '../utils/favorites.js'
import { formatMoney } from '../utils/rates.js'
import { capacityLabel, modalityLabel } from '../utils/windows.js'
import './ClassCard.css'

// Lo que se puede tocar adentro de la tarjeta sin abrirla.
const INTERACTIVE = 'button, a, input, textarea, select, label'

/**
 * Una clase en una tarjeta: cuándo, qué, si es individual o grupal,
 * modalidad y precio. Tocarla abre el detalle (onOpen), que es donde se ven
 * los alumnos, se decide sobre cada uno, se toma lista y se carga el
 * material; en la tarjeta quedan los botones rápidos, sin tomar lista.
 *
 * Para el docente una grupal es UNA tarjeta aunque sean varias reservas
 * (`rows`, una por alumno): no lleva nombres, y sus botones (TurnActions)
 * actúan sobre la clase entera. El alumno ve su reserva, con el docente.
 *
 * La tarjeta entera es clickeable para el dedo, y la materia es además un
 * botón de verdad para el teclado y los lectores de pantalla: un <li> con
 * onClick solo no se puede enfocar.
 */
class ClassCard extends Component {
  handleClick = (event) => {
    // Los clicks de adentro de un portal (el diálogo de cancelar de
    // ClassActions) también llegan acá por el árbol de React: si el DOM no
    // está adentro de la tarjeta, no es un click en la tarjeta.
    if (!event.currentTarget.contains(event.target)) return
    if (event.target.closest(INTERACTIVE)) return
    this.props.onOpen(this.props.cls)
  }

  handleOpen = () => this.props.onOpen(this.props.cls)

  rows() {
    return this.props.rows && this.props.rows.length > 0 ? this.props.rows : [this.props.cls]
  }

  /**
   * "Individual" o "Grupal · 2 de 3". El docente cuenta las reservas en pie
   * del turno; el alumno no las tiene, ve `enrolled`.
   */
  getKind() {
    const { cls, viewRole } = this.props
    if (cls.maxStudents <= 1) return capacityLabel(cls.maxStudents)
    const anotados =
      viewRole === 'teacher'
        ? this.rows().filter((row) => row.status !== 'cancelada').length
        : cls.enrolled
    return anotados ? `Grupal · ${anotados} de ${cls.maxStudents}` : capacityLabel(cls.maxStudents)
  }

  renderActions() {
    const { cls, viewRole, onChange } = this.props
    if (viewRole === 'teacher') return <TurnActions rows={this.rows()} onChange={onChange} />
    return <ClassActions cls={cls} viewRole={viewRole} exclude={['attend']} onChange={onChange} />
  }

  render() {
    const { cls, viewRole, favoriteIds, showActions, badge } = this.props

    return (
      <li className="class-card" onClick={this.handleClick}>
        <div className="class-card-head">
          <span className="class-card-date">{formatDayLong(fromISODate(cls.date))}</span>
          <span className="class-card-time">{formatRangeLabel(cls.startTime, cls.endTime)}</span>
          {badge ? <span className={`class-card-badge is-${badge.tone}`}>{badge.label}</span> : null}
        </div>
        <button type="button" className="class-card-subject" onClick={this.handleOpen}>
          {cls.subjectName}
          {cls.hasMaterial ? (
            <span className="class-card-material" role="img" aria-label="Tiene material de la clase">
              <PaperclipIcon />
            </span>
          ) : null}
        </button>
        <div className="class-card-meta-row">
          <p className="class-card-meta">
            {viewRole === 'teacher' ? '' : `Docente: ${cls.teacherName} · `}
            {this.getKind()}
            {` · ${modalityLabel(cls.modality)}`}
            {` · ${formatMoney(cls.priceCents)}`}
            {/* En una grupal cada alumno paga lo suyo. */}
            {viewRole === 'teacher' && cls.maxStudents > 1 ? ' c/u' : ''}
            {cls.packTokens > 0
              ? ` · ${cls.packTokens === 1 ? '1 clase' : `${cls.packTokens} clases`} del paquete`
              : ''}
          </p>
          {viewRole === 'student' && favoriteIds ? (
            <FavoriteButton
              teacherId={cls.teacherId}
              teacherName={cls.teacherName}
              favorite={isFavorite(favoriteIds, cls.teacherId)}
              onChange={this.props.onFavoriteChange}
              onError={this.props.onFavoriteError}
            />
          ) : null}
        </div>
        {showActions ? this.renderActions() : null}
      </li>
    )
  }
}

ClassCard.defaultProps = {
  viewRole: 'student',
  // Ids de los docentes favoritos del alumno; null = sin corazones.
  favoriteIds: null,
  // Las reservas de la clase (el turno), canceladas incluidas. Para el
  // docente, una por alumno; si no se pasan, la clase es solo `cls`.
  rows: null,
  showActions: true,
  // { label, tone } para una marca arriba a la derecha ("En curso").
  badge: null,
  onOpen: () => {},
  onChange: () => {},
  onFavoriteChange: () => {},
  onFavoriteError: () => {},
}

export default ClassCard

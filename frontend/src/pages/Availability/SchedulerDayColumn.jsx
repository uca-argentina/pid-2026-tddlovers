import { Component } from 'react'
import SchedulerCell from './SchedulerCell.jsx'
import { buildDayColumn, dayLabel, slotIdAt } from '../../utils/availability.js'

// Abajo de esto no entra '14:00 – 15:00' adentro del bloque.
const MIN_LABEL_HEIGHT = 26

/**
 * Una columna = un día. Dibuja las DOS CAPAS sobre la misma grilla CSS: abajo
 * los botones de media hora (uno por fila) y encima los bloques ya fusionados,
 * con grid-row: span N y pointer-events: none.
 *
 * Un elemento que abarca varias filas tapa también los gaps de 1px que hay
 * entre ellas, así que el bloque borra sus propias líneas internas y se ve como
 * un rectángulo entero — el mismo truco de líneas finitas de MonthGrid, al
 * revés. Y como no recibe eventos, el área sensible sigue siendo la celda de
 * media hora que tiene debajo.
 *
 * Los bloques van con aria-hidden: lo semántico son los botones. Si no, un
 * lector de pantalla leería '14:00 – 15:00' y después las dos celdas otra vez.
 *
 * Todos los eventos se escuchan acá y no en cada celda: son 3 listeners por
 * columna en vez de 3 por celda, y las celdas quedan sin props que cambien de
 * identidad en cada render.
 */
class SchedulerDayColumn extends Component {
  shouldComponentUpdate(nextProps) {
    if (
      nextProps.selectedIds !== this.props.selectedIds ||
      nextProps.blockedBySlot !== this.props.blockedBySlot ||
      nextProps.savedIds !== this.props.savedIds ||
      nextProps.invalidIds !== this.props.invalidIds ||
      nextProps.focusedId !== this.props.focusedId ||
      nextProps.fromIndex !== this.props.fromIndex ||
      nextProps.toIndex !== this.props.toIndex ||
      nextProps.slotHeight !== this.props.slotHeight
    ) {
      return true
    }

    // Una columna que no participa del arrastre no cambia. Con 7 columnas esto
    // saca la mayor parte del trabajo de cada paso.
    const participaba = this.props.draftDay === this.props.dayKey
    const participa = nextProps.draftDay === nextProps.dayKey
    if (!participaba && !participa) return false

    return (
      participaba !== participa ||
      nextProps.draftFrom !== this.props.draftFrom ||
      nextProps.draftTo !== this.props.draftTo
    )
  }

  /** El estado que se está dibujando, con el arrastre en curso aplicado. */
  getPreviewIds() {
    const { dayKey, selectedIds, draftDay, draftFrom, draftTo, draftMode, blockedBySlot } =
      this.props

    if (draftDay !== dayKey || draftFrom === null || draftTo === null) return selectedIds

    const preview = new Set(selectedIds)
    const from = Math.min(draftFrom, draftTo)
    const to = Math.max(draftFrom, draftTo)

    for (let index = from; index <= to; index++) {
      const id = slotIdAt(dayKey, index)
      // Los horarios ocupados por otra materia no se pintan ni se despintan.
      if (blockedBySlot[id]) continue
      if (draftMode === 'add') preview.add(id)
      else preview.delete(id)
    }

    return preview
  }

  /**
   * El bloque es aria-hidden, así que la celda es el único lugar donde un
   * lector de pantalla se entera de en qué estado está este horario — y el
   * color solo no le sirve a nadie. La regla ("las clases duran 1 hora") se
   * explica una sola vez, en el cartel y en el renglón de estado: repetirla por
   * celda sería ruido.
   */
  getCellLabel(cell) {
    const dia = dayLabel(this.props.dayKey)
    if (cell.state === 'blocked') return `${dia} ${cell.time}, ocupado por ${cell.blockedBy}`
    if (cell.state === 'removed') return `${dia} ${cell.time}, se va a borrar`
    if (cell.state !== 'selected') return `${dia} ${cell.time}`

    const partes = [cell.pending ? 'disponible sin guardar' : 'disponible']
    if (cell.invalid) partes.push('dura media hora')
    return `${dia} ${cell.time}, ${partes.join(', ')}`
  }

  render() {
    const { dayKey, fromIndex, toIndex, blockedBySlot, savedIds, invalidIds } = this.props
    const { focusedId, slotHeight } = this.props

    const { cells, blocks } = buildDayColumn({
      dayKey,
      fromIndex,
      toIndex,
      selectedIds: this.getPreviewIds(),
      savedIds,
      blockedBySlot,
      invalidIds,
    })

    return (
      <div
        className="sched-day"
        data-day={dayKey}
        onPointerDown={this.props.onPointerDown}
        onPointerOver={this.props.onPointerOver}
        onClick={this.props.onClick}
        onKeyDown={this.props.onKeyDown}
      >
        {cells.map((cell) => (
          <SchedulerCell
            key={cell.id}
            dayKey={dayKey}
            index={cell.index}
            row={cell.index - fromIndex + 1}
            state={cell.state}
            pending={cell.pending}
            invalid={cell.invalid}
            isHalf={cell.isHalf}
            focusable={cell.id === focusedId}
            label={this.getCellLabel(cell)}
          />
        ))}

        {blocks.map((block) => {
          // La etiqueta se dibuja si el bloque ENTERO tiene alto para ella: un
          // bloque de una hora son dos celdas, así que entra aunque una sola no
          // entraría.
          const compacto = block.span * slotHeight < MIN_LABEL_HEIGHT
          // Cuál bloque toca el borde de arriba y cuál el de abajo NO se puede
          // saber desde el CSS: van por grid-row y en el DOM están todos juntos
          // al final. Se mide contra el rango VISIBLE, así que recortar con
          // startHour/endHour mueve la marca junto con la grilla.
          const arriba = block.from === fromIndex
          const abajo = block.from + block.span === toIndex

          const clases = ['sched-block', `is-${block.state}`]
          if (block.pending) clases.push('is-pending')
          if (block.invalid) clases.push('is-invalid')
          if (compacto) clases.push('is-compact')
          if (arriba) clases.push('is-first-row')
          if (abajo) clases.push('is-last-row')

          return (
            <div
              key={block.key}
              className={clases.join(' ')}
              style={{ gridRow: `${block.from - fromIndex + 1} / span ${block.span}` }}
              aria-hidden="true"
            >
              <span className="sched-block-time">{block.label}</span>
              {block.blockedBy ? (
                <span className="sched-block-subject">{block.blockedBy}</span>
              ) : null}
            </div>
          )
        })}
      </div>
    )
  }
}

SchedulerDayColumn.defaultProps = {
  blockedBySlot: {},
  savedIds: new Set(),
  invalidIds: new Set(),
  draftDay: null,
  draftFrom: null,
  draftTo: null,
  draftMode: null,
  focusedId: null,
  slotHeight: 14,
}

export default SchedulerDayColumn

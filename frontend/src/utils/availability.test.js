import {
  buildDayColumn,
  copyDayTo,
  countSlots,
  DAY_KEYS,
  DAY_LABELS,
  dayLabel,
  findShortRuns,
  formatRangeLabel,
  formatShortRunsError,
  formatShortRunsStatus,
  formatSlotTotal,
  hourRangeToIndexes,
  mergeSchedules,
  parseSlotId,
  rangesToSlotIds,
  runsToSlotIds,
  sameSlots,
  slotId,
  slotIdAt,
  slotIdsBetween,
  slotIdsToRanges,
  slotIndexToTime,
  SLOTS_PER_DAY,
  timeToSlotIndex,
} from './availability.js'
import { DAYS_IN_WEEK, WEEKDAY_LABELS } from './calendar.js'

// El horario del enunciado: todos los días, pero los lunes de 01:00 a 18:00 y
// los viernes de 14:00 a 15:00 y de 16:30 a 17:30 (con un hueco real en el
// medio). Es el caso que tiene que sobrevivir la ida y la vuelta.
const HORARIO_EJEMPLO = {
  lunes: [{ start: '01:00', end: '18:00' }],
  viernes: [
    { start: '14:00', end: '15:00' },
    { start: '16:30', end: '17:30' },
  ],
}

describe('DAY_KEYS', () => {
  it('son siete y arrancan en lunes', () => {
    expect(DAY_KEYS).toHaveLength(DAYS_IN_WEEK)
    expect(DAY_KEYS[0]).toBe('lunes')
    expect(DAY_KEYS[6]).toBe('domingo')
  })

  it('son ASCII sin acentos', () => {
    // Es contrato de API y de base, no texto de pantalla: 'miércoles' puede
    // venir en NFC o NFD y comparar distinto. Este test es el que sostiene la
    // decisión cuando alguien quiera "arreglar" los acentos.
    for (const key of DAY_KEYS) {
      expect(key).toMatch(/^[a-z]+$/)
    }
  })

  it('están alineadas con las etiquetas y con el calendario', () => {
    expect(DAY_LABELS).toHaveLength(DAY_KEYS.length)
    expect(WEEKDAY_LABELS).toHaveLength(DAY_KEYS.length)
    // El índice 0 es lunes en los tres.
    expect(DAY_LABELS[0]).toBe('Lunes')
    expect(WEEKDAY_LABELS[0]).toBe('Lun')
    expect(dayLabel('miercoles')).toBe('Miércoles')
  })
})

describe('slotIndexToTime', () => {
  it('convierte el índice en hora', () => {
    expect(slotIndexToTime(0)).toBe('00:00')
    expect(slotIndexToTime(27)).toBe('13:30')
    expect(slotIndexToTime(47)).toBe('23:30')
  })

  it('el índice 48 es el fin del día', () => {
    // '24:00' y no '00:00': si no, un rango que termina a medianoche rompe
    // start < end para cualquiera que ordene o valide.
    expect(slotIndexToTime(SLOTS_PER_DAY)).toBe('24:00')
  })
})

describe('timeToSlotIndex', () => {
  it('es la inversa de slotIndexToTime', () => {
    for (let index = 0; index <= SLOTS_PER_DAY; index++) {
      expect(timeToSlotIndex(slotIndexToTime(index))).toBe(index)
    }
  })

  it('rechaza horas que no son en punto ni y media', () => {
    expect(timeToSlotIndex('13:15')).toBe(-1)
    expect(timeToSlotIndex('24:30')).toBe(-1)
    expect(timeToSlotIndex('cualquiera')).toBe(-1)
    expect(timeToSlotIndex(undefined)).toBe(-1)
  })
})

describe('slotId', () => {
  it('arma y desarma el id', () => {
    expect(slotId('lunes', '13:30')).toBe('lunes-1330')
    expect(slotIdAt('lunes', 27)).toBe('lunes-1330')
    expect(parseSlotId('lunes-1330')).toEqual({ dayKey: 'lunes', time: '13:30', index: 27 })
  })

  it('rechaza ids inválidos', () => {
    expect(parseSlotId('lunes-1315')).toBeNull()
    expect(parseSlotId('xx-1330')).toBeNull()
    expect(parseSlotId('')).toBeNull()
    expect(parseSlotId(null)).toBeNull()
  })
})

describe('slotIdsBetween', () => {
  it('es inclusivo y no depende del orden', () => {
    const ida = slotIdsBetween('lunes', 4, 6)
    const vuelta = slotIdsBetween('lunes', 6, 4)
    expect(ida).toEqual(['lunes-0200', 'lunes-0230', 'lunes-0300'])
    expect(vuelta).toEqual(ida)
  })

  it('un solo índice da un solo id', () => {
    expect(slotIdsBetween('martes', 10, 10)).toEqual(['martes-0500'])
  })
})

describe('hourRangeToIndexes', () => {
  it('recorta a las horas visibles', () => {
    expect(hourRangeToIndexes(8, 20)).toEqual({ fromIndex: 16, toIndex: 40 })
  })

  it('con valores raros vuelve al día entero', () => {
    expect(hourRangeToIndexes(20, 8)).toEqual({ fromIndex: 0, toIndex: 48 })
    expect(hourRangeToIndexes(-2, 20)).toEqual({ fromIndex: 0, toIndex: 48 })
    expect(hourRangeToIndexes(0, 30)).toEqual({ fromIndex: 0, toIndex: 48 })
  })
})

describe('rangesToSlotIds', () => {
  it('expande un rango en medias horas', () => {
    const ids = rangesToSlotIds({ lunes: [{ start: '09:00', end: '10:30' }] })
    expect([...ids].sort()).toEqual(['lunes-0900', 'lunes-0930', 'lunes-1000'])
  })

  it('el fin es exclusivo', () => {
    const ids = rangesToSlotIds({ lunes: [{ start: '09:00', end: '09:30' }] })
    expect([...ids]).toEqual(['lunes-0900'])
  })

  it('maneja los dos rangos del viernes del ejemplo', () => {
    const ids = rangesToSlotIds(HORARIO_EJEMPLO)
    expect(ids.has('viernes-1400')).toBe(true)
    expect(ids.has('viernes-1430')).toBe(true)
    // El hueco: 15:00 a 16:30 no está.
    expect(ids.has('viernes-1500')).toBe(false)
    expect(ids.has('viernes-1600')).toBe(false)
    expect(ids.has('viernes-1630')).toBe(true)
    expect(ids.has('viernes-1700')).toBe(true)
    expect(ids.has('viernes-1730')).toBe(false)
  })

  it('acepta 24:00 como fin', () => {
    const ids = rangesToSlotIds({ lunes: [{ start: '23:00', end: '24:00' }] })
    expect([...ids].sort()).toEqual(['lunes-2300', 'lunes-2330'])
  })

  it('ignora lo que no entiende en vez de explotar', () => {
    // Defensiva: esto va a comer lo que mande el backend.
    const ids = rangesToSlotIds({
      lunes: [{ start: '09:00', end: '10:00' }],
      lunedi: [{ start: '09:00', end: '10:00' }],
      martes: [{ start: '09:15', end: '10:00' }],
      miercoles: [{ start: '10:00', end: '09:00' }],
      jueves: 'cualquier cosa',
    })
    expect([...ids].sort()).toEqual(['lunes-0900', 'lunes-0930'])
  })

  it('sin horario da un Set vacío', () => {
    expect(rangesToSlotIds({}).size).toBe(0)
    expect(rangesToSlotIds(null).size).toBe(0)
  })
})

describe('slotIdsToRanges', () => {
  it('colapsa las medias horas seguidas en un solo rango', () => {
    const ids = new Set(['lunes-0900', 'lunes-0930', 'lunes-1000'])
    expect(slotIdsToRanges(ids)).toEqual({ lunes: [{ start: '09:00', end: '10:30' }] })
  })

  it('NO colapsa a través de un hueco', () => {
    const ids = new Set(['viernes-1400', 'viernes-1430', 'viernes-1630', 'viernes-1700'])
    expect(slotIdsToRanges(ids)).toEqual({
      viernes: [
        { start: '14:00', end: '15:00' },
        { start: '16:30', end: '17:30' },
      ],
    })
  })

  it('devuelve los días en el orden de DAY_KEYS aunque el Set venga desordenado', () => {
    const ids = new Set(['domingo-0900', 'lunes-0900', 'miercoles-0900'])
    expect(Object.keys(slotIdsToRanges(ids))).toEqual(['lunes', 'miercoles', 'domingo'])
  })

  it('omite los días sin nada', () => {
    const ranges = slotIdsToRanges(new Set(['lunes-0900']))
    expect(Object.keys(ranges)).toEqual(['lunes'])
  })

  it('el último slot del día termina en 24:00', () => {
    expect(slotIdsToRanges(new Set(['lunes-2330']))).toEqual({
      lunes: [{ start: '23:30', end: '24:00' }],
    })
  })

  it('ignora los ids que no entiende', () => {
    expect(slotIdsToRanges(new Set(['basura', 'lunes-0900']))).toEqual({
      lunes: [{ start: '09:00', end: '09:30' }],
    })
  })

  it('un Set vacío da un objeto vacío', () => {
    expect(slotIdsToRanges(new Set())).toEqual({})
  })
})

describe('ida y vuelta entre rangos y slots', () => {
  it('el horario del ejemplo sobrevive el viaje completo', () => {
    expect(slotIdsToRanges(rangesToSlotIds(HORARIO_EJEMPLO))).toEqual(HORARIO_EJEMPLO)
  })

  it('sobrevive también un horario de todos los días', () => {
    const todos = {}
    for (const dayKey of DAY_KEYS) {
      todos[dayKey] = [{ start: '08:00', end: '12:00' }]
    }
    expect(slotIdsToRanges(rangesToSlotIds(todos))).toEqual(todos)
  })
})

describe('buildDayColumn', () => {
  const base = { dayKey: 'lunes', fromIndex: 0, toIndex: 48, blockedBySlot: {} }

  it('dibuja una celda por media hora visible', () => {
    const { cells } = buildDayColumn({ ...base, selectedIds: new Set() })
    expect(cells).toHaveLength(48)
    expect(cells[0]).toMatchObject({ id: 'lunes-0000', time: '00:00', state: 'free' })
  })

  it('respeta el rango visible', () => {
    const { cells } = buildDayColumn({
      ...base,
      fromIndex: 16,
      toIndex: 40,
      selectedIds: new Set(),
    })
    expect(cells).toHaveLength(24)
    expect(cells[0].time).toBe('08:00')
  })

  it('fusiona dos medias horas seguidas en un bloque con etiqueta', () => {
    const { blocks } = buildDayColumn({
      ...base,
      selectedIds: new Set(['lunes-1400', 'lunes-1430']),
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ span: 2, label: '14:00 – 15:00', state: 'selected' })
  })

  it('un hueco parte el bloque en dos', () => {
    const { blocks } = buildDayColumn({
      ...base,
      selectedIds: new Set(['lunes-1400', 'lunes-1430', 'lunes-1630', 'lunes-1700']),
    })
    expect(blocks.map((block) => block.label)).toEqual(['14:00 – 15:00', '16:30 – 17:30'])
  })

  it('el bloque ocupado dice qué materia lo ocupa', () => {
    const { blocks, cells } = buildDayColumn({
      ...base,
      selectedIds: new Set(),
      blockedBySlot: { 'lunes-0900': 'Matemática', 'lunes-0930': 'Matemática' },
    })
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ state: 'blocked', blockedBy: 'Matemática', span: 2 })
    expect(cells[18]).toMatchObject({ state: 'blocked', blockedBy: 'Matemática' })
  })

  it('dos materias distintas pegadas NO se fusionan', () => {
    // Un solo bloque diría el nombre de una sola y mentiría sobre la otra.
    const { blocks } = buildDayColumn({
      ...base,
      selectedIds: new Set(),
      blockedBySlot: { 'lunes-0900': 'Matemática', 'lunes-0930': 'Álgebra' },
    })
    expect(blocks).toHaveLength(2)
    expect(blocks.map((block) => block.blockedBy)).toEqual(['Matemática', 'Álgebra'])
  })

  it('lo ocupado gana sobre lo seleccionado', () => {
    const { cells } = buildDayColumn({
      ...base,
      selectedIds: new Set(['lunes-0900']),
      blockedBySlot: { 'lunes-0900': 'Matemática' },
    })
    expect(cells[18].state).toBe('blocked')
  })

  it('marca inválido el tramo que le señalan, sin dejar de estar seleccionado', () => {
    const { blocks, cells } = buildDayColumn({
      ...base,
      selectedIds: new Set(['lunes-0530']),
      invalidIds: new Set(['lunes-0530']),
    })
    expect(blocks[0]).toMatchObject({ state: 'selected', invalid: true, span: 1 })
    expect(cells[11]).toMatchObject({ state: 'selected', invalid: true })
  })

  it('un tramo válido cortado por el rango visible NO se marca solo por ser corto', () => {
    // 08:30–09:30 dura una hora, pero con fromIndex 18 (09:00) se ve media. La
    // validez la decide findShortRuns sobre TODOS los slots, no el span visible
    // — si se dedujera del span, esto daría un falso positivo.
    const { blocks } = buildDayColumn({
      ...base,
      fromIndex: 18,
      toIndex: 40,
      selectedIds: new Set(['lunes-0830', 'lunes-0900']),
      invalidIds: new Set(),
    })
    expect(blocks[0]).toMatchObject({ span: 1, invalid: false })
  })

  it('sin invalidIds nada es inválido', () => {
    const { blocks } = buildDayColumn({ ...base, selectedIds: new Set(['lunes-0530']) })
    expect(blocks[0].invalid).toBe(false)
  })

  it('marca las medias horas para poder pintarlas distinto', () => {
    const { cells } = buildDayColumn({ ...base, selectedIds: new Set() })
    expect(cells[0].isHalf).toBe(false)
    expect(cells[1].isHalf).toBe(true)
  })
})

describe('copyDayTo', () => {
  const lunes = new Set(['lunes-0900', 'lunes-0930'])

  it('copia a varios días', () => {
    const { slotIds } = copyDayTo(lunes, 'lunes', ['martes', 'miercoles'])
    expect(slotIdsToRanges(slotIds)).toEqual({
      lunes: [{ start: '09:00', end: '10:00' }],
      martes: [{ start: '09:00', end: '10:00' }],
      miercoles: [{ start: '09:00', end: '10:00' }],
    })
  })

  it('reemplaza el destino en vez de sumar', () => {
    const conMartes = new Set([...lunes, 'martes-2000'])
    const { slotIds } = copyDayTo(conMartes, 'lunes', ['martes'])
    expect(slotIdsToRanges(slotIds).martes).toEqual([{ start: '09:00', end: '10:00' }])
  })

  it('copiar un día vacío limpia el destino', () => {
    const soloMartes = new Set(['martes-2000'])
    const { slotIds } = copyDayTo(soloMartes, 'lunes', ['martes'])
    expect(slotIdsToRanges(slotIds)).toEqual({})
  })

  it('saltea los horarios ocupados y los cuenta', () => {
    const { slotIds, skipped } = copyDayTo(lunes, 'lunes', ['martes'], {
      'martes-0930': 'Matemática',
    })
    expect(skipped).toBe(1)
    expect(slotIdsToRanges(slotIds).martes).toEqual([{ start: '09:00', end: '09:30' }])
  })

  it('no se copia a sí mismo', () => {
    const { slotIds } = copyDayTo(lunes, 'lunes', ['lunes'])
    expect(sameSlots(slotIds, lunes)).toBe(true)
  })
})

describe('sameSlots', () => {
  it('reconoce dos conjuntos iguales', () => {
    expect(sameSlots(new Set(['a', 'b']), new Set(['b', 'a']))).toBe(true)
  })

  it('distingue por tamaño y por contenido', () => {
    expect(sameSlots(new Set(['a']), new Set(['a', 'b']))).toBe(false)
    expect(sameSlots(new Set(['a']), new Set(['b']))).toBe(false)
  })
})

describe('countSlots', () => {
  it('cuenta todo o solo un día', () => {
    const ids = new Set(['lunes-0900', 'lunes-0930', 'martes-0900'])
    expect(countSlots(ids)).toBe(3)
    expect(countSlots(ids, 'lunes')).toBe(2)
    expect(countSlots(ids, 'domingo')).toBe(0)
  })
})

describe('mergeSchedules', () => {
  it('une varios horarios sin duplicar', () => {
    const ids = mergeSchedules([
      { lunes: [{ start: '09:00', end: '10:00' }] },
      { lunes: [{ start: '09:30', end: '10:30' }] },
    ])
    expect(slotIdsToRanges(ids)).toEqual({ lunes: [{ start: '09:00', end: '10:30' }] })
  })
})

describe('formatRangeLabel', () => {
  it('usa 24 h como el resto de la app', () => {
    expect(formatRangeLabel('14:00', '15:00')).toBe('14:00 – 15:00')
  })
})

describe('formatSlotTotal', () => {
  it('cuenta medias horas en horas', () => {
    expect(formatSlotTotal(2)).toBe('1 h')
    expect(formatSlotTotal(3)).toBe('1 h 30 min')
    expect(formatSlotTotal(1)).toBe('30 min')
    expect(formatSlotTotal(0)).toBe('0 min')
  })
})

describe('findShortRuns', () => {
  it('una media hora suelta no llega a una clase', () => {
    expect(findShortRuns(new Set(['martes-0530']))).toEqual([
      { dayKey: 'martes', start: '05:30', end: '06:00' },
    ])
  })

  it('una hora está bien', () => {
    expect(findShortRuns(new Set(['martes-0530', 'martes-0600']))).toEqual([])
  })

  it('1 h 30 también está bien: no tiene que ser múltiplo de la clase', () => {
    expect(findShortRuns(new Set(['martes-0530', 'martes-0600', 'martes-0630']))).toEqual([])
  })

  it('mide cada tramo por separado, no el día entero', () => {
    // 14:00–15:00 está bien; la de 16:30 está sola. Dos tramos del mismo día no
    // se suman: entre medio hay un hueco.
    const ids = new Set(['viernes-1400', 'viernes-1430', 'viernes-1630'])
    expect(findShortRuns(ids)).toEqual([{ dayKey: 'viernes', start: '16:30', end: '17:00' }])
  })

  it('los devuelve en el orden de DAY_KEYS aunque el Set venga desordenado', () => {
    const runs = findShortRuns(new Set(['jueves-1200', 'lunes-0800', 'martes-0530']))
    expect(runs.map((run) => run.dayKey)).toEqual(['lunes', 'martes', 'jueves'])
  })

  it('la última media hora del día termina en 24:00', () => {
    expect(findShortRuns(new Set(['lunes-2330']))).toEqual([
      { dayKey: 'lunes', start: '23:30', end: '24:00' },
    ])
  })

  it('sin nada pintado no hay tramos cortos', () => {
    expect(findShortRuns(new Set())).toEqual([])
  })
})

describe('runsToSlotIds', () => {
  it('devuelve los ids de cada tramo', () => {
    const runs = [
      { dayKey: 'martes', start: '05:30', end: '06:00' },
      { dayKey: 'jueves', start: '12:00', end: '12:30' },
    ]
    expect([...runsToSlotIds(runs)].sort()).toEqual(['jueves-1200', 'martes-0530'])
  })

  it('sin tramos da un Set vacío', () => {
    expect(runsToSlotIds([]).size).toBe(0)
  })
})

describe('formatShortRunsError', () => {
  const martes = { dayKey: 'martes', start: '05:30', end: '06:00' }
  const jueves = { dayKey: 'jueves', start: '12:00', end: '12:30' }

  it('uno solo va en singular', () => {
    expect(formatShortRunsError([martes])).toBe(
      'No se puede guardar: Martes 05:30 – 06:00 dura media hora, y las clases duran 1 hora.',
    )
  })

  it('dos se unen con "y" y el verbo va en plural', () => {
    expect(formatShortRunsError([martes, jueves])).toContain(
      'Martes 05:30 – 06:00 y Jueves 12:00 – 12:30 duran media hora',
    )
  })

  it('más de tres se cortan para que el cartel se pueda leer', () => {
    const cinco = DAY_KEYS.slice(0, 5).map((dayKey) => ({ dayKey, start: '08:00', end: '08:30' }))
    expect(formatShortRunsError(cinco)).toContain('y 2 horarios más duran media hora')
  })

  it('con uno solo de más lo dice en singular', () => {
    const cuatro = DAY_KEYS.slice(0, 4).map((dayKey) => ({ dayKey, start: '08:00', end: '08:30' }))
    expect(formatShortRunsError(cuatro)).toContain('y 1 horario más')
  })

  it('sin tramos no hay cartel', () => {
    expect(formatShortRunsError([])).toBeNull()
  })
})

describe('formatShortRunsStatus', () => {
  it('nombra los tramos sin el prefijo de error', () => {
    expect(formatShortRunsStatus([{ dayKey: 'martes', start: '05:30', end: '06:00' }])).toBe(
      'Martes 05:30 – 06:00 dura media hora.',
    )
  })

  it('sin tramos no dice nada', () => {
    expect(formatShortRunsStatus([])).toBe('')
  })
})

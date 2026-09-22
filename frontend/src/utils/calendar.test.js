import {
  addDays,
  addMonths,
  addOneHour,
  buildMonthGrid,
  formatDuration,
  formatMonthTitle,
  fromISODate,
  isSameDay,
  isValidSlotStart,
  mondayIndex,
  toISODate,
  WEEKDAY_LABELS,
} from './calendar.js'

// Fechas fijas a propósito: nada acá depende de qué día es hoy. Los meses
// van 0-indexed, igual que Date (0 = enero).

describe('mondayIndex', () => {
  it('arranca la semana en lunes', () => {
    expect(mondayIndex(new Date(2026, 8, 14))).toBe(0) // lunes
    expect(mondayIndex(new Date(2026, 8, 19))).toBe(5) // sábado
    expect(mondayIndex(new Date(2026, 8, 20))).toBe(6) // domingo
  })
})

describe('toISODate', () => {
  it('usa la hora local, no UTC', () => {
    // Con toISOString() esto daría '2025-12-31' en husos negativos (y el CI
    // corre en UTC), así que este test es el que protege la implementación.
    expect(toISODate(new Date(2026, 0, 1))).toBe('2026-01-01')
    expect(toISODate(new Date(2026, 0, 1, 23, 59))).toBe('2026-01-01')
    expect(toISODate(new Date(2026, 11, 31))).toBe('2026-12-31')
  })

  it('rellena mes y día con cero', () => {
    expect(toISODate(new Date(2026, 4, 5))).toBe('2026-05-05')
  })

  it('es ida y vuelta con fromISODate', () => {
    expect(toISODate(fromISODate('2026-03-09'))).toBe('2026-03-09')
  })
})

describe('addMonths', () => {
  it('no se desborda cuando el día no existe en el mes destino', () => {
    const result = addMonths(new Date(2026, 0, 31), 1)
    expect(result.getMonth()).toBe(1) // febrero, no marzo
    expect(result.getDate()).toBe(1)
  })

  it('cruza el fin de año en los dos sentidos', () => {
    expect(toISODate(addMonths(new Date(2026, 11, 15), 1))).toBe('2027-01-01')
    expect(toISODate(addMonths(new Date(2026, 0, 15), -1))).toBe('2025-12-01')
  })
})

describe('addDays', () => {
  it('cruza el límite de mes', () => {
    expect(toISODate(addDays(new Date(2026, 8, 30), 1))).toBe('2026-10-01')
    expect(toISODate(addDays(new Date(2026, 8, 1), -1))).toBe('2026-08-31')
  })
})

describe('isSameDay', () => {
  it('ignora la hora', () => {
    expect(isSameDay(new Date(2026, 8, 14, 0, 0), new Date(2026, 8, 14, 23, 59))).toBe(true)
  })

  it('distingue días de meses distintos', () => {
    expect(isSameDay(new Date(2026, 8, 1), new Date(2026, 7, 1))).toBe(false)
  })
})

describe('addOneHour', () => {
  it('suma una hora manteniendo los minutos', () => {
    expect(addOneHour('16:30')).toBe('17:30')
    expect(addOneHour('09:00')).toBe('10:00')
  })

  it('da la vuelta a medianoche', () => {
    expect(addOneHour('23:30')).toBe('00:30')
    expect(addOneHour('23:00')).toBe('00:00')
  })
})

describe('formatDuration', () => {
  it('formatea la clase típica de una hora', () => {
    expect(formatDuration('09:00', '10:00')).toBe('1 h')
    expect(formatDuration('16:30', '17:30')).toBe('1 h')
  })

  it('maneja duraciones que no son horas enteras', () => {
    expect(formatDuration('09:00', '09:30')).toBe('30 min')
    expect(formatDuration('09:00', '10:30')).toBe('1 h 30 min')
  })

  it('maneja la clase que cruza la medianoche', () => {
    expect(formatDuration('23:30', '00:30')).toBe('1 h')
  })
})

describe('isValidSlotStart', () => {
  it('acepta solo en punto o y media', () => {
    expect(isValidSlotStart('10:00')).toBe(true)
    expect(isValidSlotStart('10:30')).toBe(true)
    expect(isValidSlotStart('00:00')).toBe(true)
    expect(isValidSlotStart('23:30')).toBe(true)
  })

  it('rechaza cualquier otro horario', () => {
    expect(isValidSlotStart('10:15')).toBe(false)
    expect(isValidSlotStart('25:00')).toBe(false)
    expect(isValidSlotStart('9:00')).toBe(false)
    expect(isValidSlotStart('')).toBe(false)
  })
})

describe('buildMonthGrid', () => {
  it('siempre devuelve 6 semanas de 7 días', () => {
    // Cualquier mes, para que la altura de la tarjeta no salte al paginar.
    for (let month = 0; month < 12; month++) {
      const weeks = buildMonthGrid(2026, month)
      expect(weeks).toHaveLength(6)
      for (const week of weeks) {
        expect(week).toHaveLength(7)
      }
    }
  })

  it('empieza cada semana en lunes', () => {
    const weeks = buildMonthGrid(2026, 8)
    for (const week of weeks) {
      expect(mondayIndex(week[0].date)).toBe(0)
      expect(mondayIndex(week[6].date)).toBe(6)
    }
    expect(WEEKDAY_LABELS[0]).toBe('Lun')
  })

  it('rellena con los días del mes anterior', () => {
    // Septiembre 2026 arranca un martes, así que la primera celda es el
    // lunes 31 de agosto.
    const weeks = buildMonthGrid(2026, 8)
    expect(weeks[0][0].iso).toBe('2026-08-31')
    expect(weeks[0][0].inMonth).toBe(false)
    expect(weeks[0][1].iso).toBe('2026-09-01')
    expect(weeks[0][1].inMonth).toBe(true)
  })

  it('maneja el mes que arranca en domingo (relleno máximo)', () => {
    // Febrero 2026 arranca un domingo: 6 días de relleno adelante.
    const weeks = buildMonthGrid(2026, 1)
    const leading = weeks[0].filter((cell) => !cell.inMonth)
    expect(leading).toHaveLength(6)
    expect(weeks[0][6].iso).toBe('2026-02-01')
  })

  it('cuenta bien los días de un febrero bisiesto', () => {
    const cells = buildMonthGrid(2024, 1).flat()
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(29)
  })

  it('cuenta bien los días de un febrero común', () => {
    const cells = buildMonthGrid(2026, 1).flat()
    expect(cells.filter((cell) => cell.inMonth)).toHaveLength(28)
  })

  it('marca isToday en una sola celda si la fecha de referencia cae en el mes', () => {
    const cells = buildMonthGrid(2026, 8, new Date(2026, 8, 14)).flat()
    const today = cells.filter((cell) => cell.isToday)
    expect(today).toHaveLength(1)
    expect(today[0].iso).toBe('2026-09-14')
  })

  it('no marca isToday si la fecha de referencia está lejos del mes', () => {
    const cells = buildMonthGrid(2026, 8, new Date(2020, 0, 15)).flat()
    expect(cells.filter((cell) => cell.isToday)).toHaveLength(0)
  })

  it('marca el fin de semana', () => {
    const weeks = buildMonthGrid(2026, 8)
    expect(weeks[0][4].isWeekend).toBe(false) // viernes
    expect(weeks[0][5].isWeekend).toBe(true) // sábado
    expect(weeks[0][6].isWeekend).toBe(true) // domingo
  })
})

describe('formatMonthTitle', () => {
  it('devuelve el mes y el año capitalizados', () => {
    expect(formatMonthTitle(new Date(2026, 8, 1))).toBe('Septiembre de 2026')
  })
})

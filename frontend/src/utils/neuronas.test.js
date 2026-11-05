import {
  formatNeuronas,
  homeworkEarns,
  levelProgress,
  movementLabel,
  rewardFits,
  rewardLabel,
  rewardPriceCents,
} from './neuronas.js'

describe('neuronas', () => {
  const hora = { hourlyRateCents: 500000, minutes: 60 }

  it('calcula lo mismo que el backend', () => {
    expect(rewardPriceCents('free_60', hora)).toBe(0)
    expect(rewardPriceCents('free_30', hora)).toBe(250000)
    expect(rewardPriceCents('discount_10', hora)).toBe(450000)
    expect(rewardPriceCents('discount_20', { ...hora, minutes: 120 })).toBe(900000)
  })

  it('un canje no entra en una clase más corta que lo que cubre', () => {
    expect(rewardFits('free_60', 30)).toBe(false)
    expect(rewardFits('free_60', 60)).toBe(true)
    expect(rewardFits('discount_10', 30)).toBe(true)
  })

  it('formatea en singular y plural', () => {
    expect(formatNeuronas(1)).toBe('1 neurona')
    expect(formatNeuronas(1000)).toBe('1.000 neuronas')
    expect(rewardLabel('free_60')).toBe('1 h gratis')
    expect(movementLabel('homework_feedback')).toBe('Devolución de tarea')
  })

  it('mide el progreso hacia el próximo nivel', () => {
    expect(levelProgress({ min: 200, nextMin: 600 }, 400)).toBe(50)
    expect(levelProgress({ min: 1500, nextMin: null }, 9000)).toBe(100)
  })

  it('una tarea necesita 24 h de plazo, en hora argentina', () => {
    const tarea = { dueDate: '2099-09-10', dueTime: '12:00' }
    // 12:00 en Argentina son 15:00 UTC.
    expect(homeworkEarns({ ...tarea, createdAt: '2099-09-09T15:00:00.000Z' })).toBe(true)
    expect(homeworkEarns({ ...tarea, createdAt: '2099-09-09T15:00:59.000Z' })).toBe(true)
    expect(homeworkEarns({ ...tarea, createdAt: '2099-09-09T15:01:00.000Z' })).toBe(false)
  })
})

import { suggest, teacherFullName } from './search.js'

const MATERIAS = [
  { id: 's1', name: 'Matemática' },
  { id: 's2', name: 'Física' },
  { id: 's3', name: 'Análisis Matemático' },
  { id: 's4', name: 'Química' },
]

const DOCENTES = [
  { id: 't1', nombre: 'Hugo', apellido: 'Pérez', subjects: [] },
  { id: 't2', nombre: 'Laura', apellido: 'Gómez', subjects: [] },
  { id: 't3', nombre: 'Martín', apellido: 'Sosa', subjects: [] },
]

const nombres = (lista) => lista.map((item) => item.name || teacherFullName(item))

describe('suggest', () => {
  it('sin texto no sugiere nada', () => {
    expect(suggest('   ', { subjects: MATERIAS, teachers: DOCENTES })).toEqual({
      subjects: [],
      teachers: [],
    })
  })

  it('separa materias de docentes', () => {
    const res = suggest('ma', { subjects: MATERIAS, teachers: DOCENTES })

    expect(nombres(res.subjects)).toEqual(['Matemática', 'Análisis Matemático'])
    expect(nombres(res.teachers)).toEqual(['Martín Sosa'])
  })

  it('ignora acentos y mayúsculas', () => {
    const res = suggest('FISI', { subjects: MATERIAS, teachers: DOCENTES })

    expect(nombres(res.subjects)).toEqual(['Física'])
  })

  it('busca docentes por apellido', () => {
    const res = suggest('gomez', { subjects: MATERIAS, teachers: DOCENTES })

    expect(nombres(res.teachers)).toEqual(['Laura Gómez'])
  })

  it('lo que empieza con el texto va antes que lo que lo contiene en el medio', () => {
    const res = suggest('go', { subjects: MATERIAS, teachers: DOCENTES })

    expect(nombres(res.teachers)).toEqual(['Laura Gómez', 'Hugo Pérez'])
  })

  it('no corta la lista: el tope de tres es visual', () => {
    const muchas = ['Mate I', 'Mate II', 'Mate III', 'Mate IV', 'Mate V'].map((name, i) => ({
      id: `m${i}`,
      name,
    }))

    expect(suggest('mate', { subjects: muchas }).subjects).toHaveLength(5)
  })
})

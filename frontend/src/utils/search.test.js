import { resolveQuery, suggest, teacherFullName } from './search.js'

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

describe('resolveQuery', () => {
  const subjects = [
    { id: 1, name: 'Matemática' },
    { id: 2, name: 'Física' },
    { id: 3, name: 'Análisis' },
  ]

  it('el nombre exacto de una materia es un filtro de materia', () => {
    expect(resolveQuery('Matemática', subjects)).toEqual({ subjectId: 1, teacherQuery: '' })
  })

  it('no le importan los acentos ni las mayúsculas', () => {
    expect(resolveQuery('matematica', subjects)).toEqual({ subjectId: 1, teacherQuery: '' })
    expect(resolveQuery(' FISICA ', subjects)).toEqual({ subjectId: 2, teacherQuery: '' })
  })

  it('el nombre exacto gana sobre otro que empieza igual', () => {
    const conSegunda = [
      { id: 5, name: 'Física II' },
      { id: 2, name: 'Física' },
    ]
    expect(resolveQuery('Física', conSegunda)).toEqual({ subjectId: 2, teacherQuery: '' })
  })

  it('un pedazo de nombre queda como texto libre (docente o materia)', () => {
    // Bug: "Ana" se resolvía como Análisis y nunca buscaba a la docente Ana.
    expect(resolveQuery('Ana', subjects)).toEqual({ subjectId: null, teacherQuery: 'Ana' })
    expect(resolveQuery('mate', subjects)).toEqual({ subjectId: null, teacherQuery: 'mate' })
    expect(resolveQuery('gómez', subjects)).toEqual({ subjectId: null, teacherQuery: 'gómez' })
  })

  it('vacío no filtra nada', () => {
    expect(resolveQuery('', subjects)).toEqual({ subjectId: null, teacherQuery: '' })
    expect(resolveQuery('   ', subjects)).toEqual({ subjectId: null, teacherQuery: '' })
  })
})

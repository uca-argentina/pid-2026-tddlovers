// Datos de prueba compartidos por los tests. No lo importa la app.
//
// Una clase tal como la devuelve el backend (GET /api/classes, /:id y las
// acciones): los mismos campos que CLASS_COLUMNS en backend/src/db/classes.js.
// Vive en un solo lugar para que, si la forma cambia, los tests no sigan
// probando con una que ya no existe. Cada test pisa solo lo que le importa.
//
// Por defecto: individual, virtual, pendiente y sin pagar, en 2099 para que
// "ya empezó" no dependa del reloj.
export function apiClass(overrides = {}) {
  return {
    id: 'c1',
    date: '2099-09-14',
    startTime: '13:00',
    endTime: '14:00',
    subjectId: 's1',
    subjectName: 'Matemática',
    teacherId: 't1',
    teacherName: 'Laura Gómez',
    studentId: 'a1',
    studentName: 'Sofía Ramírez',
    status: 'pendiente',
    availabilityId: 'w1',
    modality: 'virtual',
    maxStudents: 1,
    meetingUrl: 'https://meet.example.com/abc',
    address: null,
    locality: null,
    priceCents: 500000,
    paidAt: null,
    cancelledBy: null,
    cancelReason: null,
    rescheduledFrom: null,
    studentPackId: null,
    packTokens: 0,
    rewardType: null,
    rewardNeuronas: 0,
    enrolled: 1,
    hasMaterial: false,
    ...overrides,
  }
}

// Un usuario tal como lo devuelven login, register, /me y el PATCH del perfil
// (toPublicUser en backend/src/lib/publicUser.js). `subjectIds` y `rates`
// vienen siempre, vacíos para un alumno; `approvalStatus` solo en docentes
// (null en el resto). Por defecto, un docente aprobado sin materias.
export function apiUser(overrides = {}) {
  return {
    id: 1,
    email: 'agustin@example.com',
    role: 'teacher',
    nombre: 'Agustín',
    apellido: 'Klos',
    telefono: null,
    approvalStatus: 'approved',
    acceptsRewards: false,
    subjectIds: [],
    rates: [],
    ...overrides,
  }
}

// Lo que responde PATCH /api/users/me: el usuario entero ya actualizado, no
// solo lo que se mandó.
export function updatedUser(user, payload) {
  return apiUser({ ...user, ...payload })
}

// Una entrega tal como viene adentro de una tarea (SUBMISSION_JSON en
// backend/src/db/homework.js). Por defecto, sin entregar.
export function apiSubmission(overrides = {}) {
  return {
    id: 'e1',
    studentId: 'a1',
    studentName: 'Sofía Ramírez',
    text: '',
    linkUrl: '',
    submittedAt: null,
    isLate: false,
    feedback: '',
    correctedAt: null,
    ...overrides,
  }
}

// Una tarea como la devuelve GET /api/homework. Sin `submissions`/`submission`:
// el docente recibe una lista y el alumno la suya, y cada test pasa la que usa.
export function apiHomework(overrides = {}) {
  return {
    id: 'h1',
    title: 'TP 1',
    description: 'Resolver la guía',
    dueDate: '2099-09-20',
    dueTime: '23:59',
    classDate: null,
    classStartTime: null,
    subjectName: null,
    teacherName: 'Laura Gómez',
    createdAt: '2099-09-01T12:00:00.000Z',
    ...overrides,
  }
}

// Lo que responde GET /api/neuronas a un alumno (routes/neuronas en el backend).
export function apiNeuronas(overrides = {}) {
  return {
    balance: 250,
    earned: 250,
    level: { name: 'Sinapsis', min: 200, nextName: 'Red neuronal', nextMin: 600 },
    movements: [],
    badges: [
      { key: 'first_class', label: 'Primera clase', earned: true },
      { key: 'ten_classes', label: '10 clases', earned: false },
      { key: 'five_homeworks', label: '5 tareas a tiempo', earned: false },
    ],
    ...overrides,
  }
}

// Lo mismo para un docente: en vez de insignias trae el estado de Destacado.
export function apiTeacherNeuronas(overrides = {}) {
  return {
    balance: 1200,
    earned: 1200,
    movements: [],
    level: { name: 'Red neuronal', min: 600, nextName: 'Mente brillante', nextMin: 1500 },
    featured: { activeUntil: null, slotsLeft: 5, cost: 1000, days: 7 },
    ...overrides,
  }
}

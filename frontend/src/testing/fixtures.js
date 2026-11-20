// Datos de prueba compartidos por los tests. No lo importa la app.
// Cada fábrica devuelve un objeto con la forma EXACTA de una respuesta del
// backend (ya desenvuelta, como la devuelve api/client.js) y acepta
// `overrides` para pisar solo lo que el test necesita. Lo usan los *.test.jsx
// / *.test.js de pages/, components/, utils/ y App.test.jsx.
//
// Una reserva tal como la devuelve el backend (GET /api/bookings, /:id y las
// acciones): los mismos campos que BOOKING_COLUMNS en backend/src/db/bookings.js.
// Vive en un solo lugar para que, si la forma cambia, los tests no sigan
// probando con una que ya no existe. Cada test pisa solo lo que le importa.
//
// Por defecto: individual, virtual, pendiente y sin pagar, en 2099 para que
// "ya empezó" no dependa del reloj.
export function apiBooking(overrides = {}) {
  // `classId` es el id de la CLASE (classes.id), compartido por las reservas
  // de una grupal. Si el test no lo da, sale del docente, la fecha y el
  // inicio: como en la base, donde hay una sola clase en pie por horario.
  const teacherId = overrides.teacherId ?? 't1'
  const date = overrides.date ?? '2099-09-14'
  const startTime = overrides.startTime ?? '13:00'
  return {
    id: 'c1',
    classId: `k-${teacherId}-${date}-${startTime}`,
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
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
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
// solo lo que se mandó. `user` es el de antes (apiUser) y `payload` lo enviado.
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

// Lo que responde GET /api/neuronas a un alumno (routes/neuronas en el backend;
// level de levelFor y badges de badgesFor en backend/src/lib/neuronas.js).
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

// Los inicios que manda el backend en `starts` para un tramo libre sin
// clases propias en el medio: cada :00/:30 donde entra una clase de 30 min,
// con la más larga que entra (de a 5 min) hasta `end`. Para armar filas de
// disponibilidad sin escribir la lista a mano; si el test necesita otra
// duración máxima (una clase propia que la corta), pasa `starts` explícito.
export function startsBetween(start, end) {
  const aMin = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5))
  const aHora = (min) =>
    `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
  const fin = aMin(end)
  const inicios = []
  for (let inicio = Math.ceil(aMin(start) / 30) * 30; inicio + 30 <= fin; inicio += 30) {
    inicios.push({ start: aHora(inicio), maxMinutes: Math.floor((fin - inicio) / 5) * 5 })
  }
  return inicios
}

// Una fila de GET /api/availability (una ventana en una fecha) tal como la
// arma bookableRows de backend/src/lib/availabilityExpansion.js: los
// `starts` ya vienen recortados para ESTE alumno y `groups` trae solo las
// grupales a las que se puede sumar, cada una con su cupo. Por defecto, Laura
// virtual individual un lunes de 2099 de 13 a 16 sin nada reservado.
export function apiAvailabilityRow(overrides = {}) {
  return {
    id: 'w1|2099-09-14',
    windowId: 'w1',
    date: '2099-09-14',
    dayKey: 'lunes',
    teacherId: 't1',
    teacherName: 'Laura Gómez',
    teacherAcceptsRewards: false,
    teacherFeatured: false,
    start: '13:00',
    end: '16:00',
    modality: 'virtual',
    maxStudents: 1,
    locality: null,
    subjects: [{ id: 's1', name: 'Matemática', hourlyRateCents: 500000 }],
    starts: startsBetween('13:00', '16:00'),
    groups: [],
    onVacation: false,
    ...overrides,
  }
}

// Un paquete comprado tal como lo devuelve GET /api/packs/mine: dos clases de
// 1 h con Laura, sin usar. `usable` lo calcula el backend (no vencido, con
// clases disponibles y docente aprobado).
export function apiStudentPack(overrides = {}) {
  return {
    id: 'p1',
    teacherId: 't1',
    teacherName: 'Laura Gómez',
    classCount: 2,
    classMinutes: 60,
    priceCents: 1000000,
    expiresOn: '2099-12-31',
    expired: false,
    remaining: 2,
    available: 2,
    usable: true,
    teacherApproved: true,
    ...overrides,
  }
}

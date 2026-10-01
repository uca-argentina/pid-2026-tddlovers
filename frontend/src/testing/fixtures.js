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
    enrolled: 1,
    ...overrides,
  }
}

// Un usuario tal como lo devuelven login, register, /me y el PATCH del perfil
// (toPublicUser en backend/src/lib/publicUser.js). `subjectIds` y `rates`
// vienen siempre, vacíos para un alumno. Por defecto, un docente sin materias.
export function apiUser(overrides = {}) {
  return {
    id: 1,
    email: 'agustin@example.com',
    role: 'teacher',
    nombre: 'Agustín',
    apellido: 'Klos',
    telefono: null,
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

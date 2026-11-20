import { getPool } from './pool.js';
import { ADDRESS_JSON, insertAddress, lockAddresses } from './addresses.js';
import { todayIso } from '../lib/clock.js';

// Las ventanas de disponibilidad del docente (crudas; la expansión por fecha
// la hace lib/availabilityExpansion.js).
// Tablas: availability (migración 003, rehecha en 006: start_date,
// repeats_weekly, modality, max_students, meeting_url; address_id de 019),
// teacher_addresses (019), teacher_rates + subjects (009/002), users
// (approval_status de 012, accepts_neurona_rewards de 021) y teacher_featured (021).
// Locks: las escrituras toman, vía lockAddresses de db/addresses.js,
//   1. 'availability:' || teacherId  2. 'addresses:' || teacherId
// La no-superposición entre ventanas se chequea acá bajo ese lock, no con
// una constraint.
// Lo usan: routes/teachers (/me/availability), routes/availability
// (findPublishedWindows) y routes/classes (findWindowById).

// La ventana tal como la espera el front: fecha 'YYYY-MM-DD' y horas 'HH:MM'.
// Se recorta acá y no en la ruta para que ningún endpoint tenga que acordarse.
const WINDOW_COLUMNS = `
  av.id,
  av.teacher_id AS "teacherId",
  to_char(av.start_date, 'YYYY-MM-DD') AS date,
  av.repeats_weekly AS "repeatsWeekly",
  to_char(av.start_time, 'HH24:MI') AS start,
  to_char(av.end_time, 'HH24:MI') AS "end",
  av.modality,
  av.max_students AS "maxStudents",
  av.meeting_url AS "meetingUrl",
  ta.locality,
  CASE WHEN ta.id IS NULL THEN NULL ELSE ${ADDRESS_JSON} END AS address
`;

// La ventana con su dirección (migración 019): la dirección vive aparte y la
// ventana apunta a ella, así que editar "Casa" cambia todas las que la usan.
// `locality` va también suelta porque es lo único que se le muestra a
// cualquier alumno (la expansión copia solo eso).
const WINDOW_FROM = `
  availability av
  LEFT JOIN teacher_addresses ta ON ta.id = av.address_id
`;

// Lo que el alumno puede reservar en la ventana: las materias que el docente
// tiene tarifadas en ESA modalidad, con la tarifa por hora. La ventana no
// guarda materias; salen del perfil del docente cada vez, así que cambiar una
// tarifa cambia lo que se ofrece sin tocar ninguna ventana.
const WINDOW_SUBJECTS = `
  COALESCE(
    (
      SELECT json_agg(
        json_build_object('id', s.id, 'name', s.name, 'hourlyRateCents', r.hourly_rate_cents)
        ORDER BY s.name
      )
      FROM teacher_rates r
      JOIN subjects s ON s.id = r.subject_id
      WHERE r.teacher_id = av.teacher_id AND r.modality = av.modality
    ),
    '[]'::json
  )
`;

// ¿Cae alguna vez en [$from, $to]? Una suelta, si su fecha está adentro; una
// semanal, si arrancó antes del final. Puede que igual no caiga (una semanal
// de los lunes en un rango miércoles–jueves): eso lo termina de decidir
// occursOn en JS, esto solo evita traer ventanas que seguro no van.
const OCCURS_IN_RANGE = (from, to) => `
  (
    (NOT av.repeats_weekly AND av.start_date BETWEEN ${from}::date AND ${to}::date)
    OR (av.repeats_weekly AND av.start_date <= ${to}::date)
  )
`;

/**
 * Las ventanas del docente que caen en el rango, sin expandir: la pantalla del
 * docente necesita la ventana entera (id, si se repite, su fecha original)
 * para poder editarla.
 *
 * @param {{teacherId: string, from: string, to: string}} args - teacherId =
 *   request.user.id; from/to = query de GET /api/teachers/me/availability ('YYYY-MM-DD').
 * @returns {Promise<Array<{id, teacherId, date, repeatsWeekly, start, end, modality,
 *   maxStudents, meetingUrl, locality, address}>>} (WINDOW_COLUMNS; address es
 *   el objeto ADDRESS_JSON o null).
 * Origen: availability LEFT JOIN teacher_addresses.
 * Lo usa: routes/teachers/index.js.
 */
export async function findTeacherWindows({ teacherId, from, to }) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS}
     FROM ${WINDOW_FROM}
     WHERE av.teacher_id = $1 AND ${OCCURS_IN_RANGE('$2', '$3')}
     ORDER BY av.start_time, av.start_date`,
    [teacherId, from, to]
  );
  return result.rows;
}

/**
 * Lo que se ofrece a los alumnos en el rango, cada ventana con `subjects`: las
 * materias que se pueden reservar en ella y su tarifa por hora. Si el docente
 * se quedó sin tarifas en la modalidad de una ventana, la ventana queda
 * guardada pero no se ofrece (la pantalla del docente se lo avisa). Lo mismo
 * con las de un docente que no está aprobado: puede cargarlas mientras espera,
 * pero no se ofrecen hasta que un admin lo apruebe.
 *
 * Ojo: devuelve meetingUrl y address completos; quien arma la respuesta al
 * alumno (lib/availabilityExpansion.js) se queda solo con `locality`.
 *
 * @param {{from: string, to: string}} rango - query de GET /api/availability, ya validado.
 * @returns {Promise<Array<object>>} WINDOW_COLUMNS + teacherName,
 *   subjects: [{id, name, hourlyRateCents}], teacherAcceptsRewards, teacherFeatured
 *   (Destacado vigente hoy en hora argentina).
 * Origen: availability + teacher_addresses + users + teacher_rates/subjects + teacher_featured.
 * Lo usa: routes/availability/index.js.
 */
export async function findPublishedWindows({ from, to }) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS},
            u.nombre || ' ' || u.apellido AS "teacherName",
            ${WINDOW_SUBJECTS} AS subjects,
            u.accepts_neurona_rewards AS "teacherAcceptsRewards",
            EXISTS (
              SELECT 1 FROM teacher_featured f
              WHERE f.teacher_id = av.teacher_id
                AND (now() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
                    BETWEEN f.start_date AND f.end_date
            ) AS "teacherFeatured"
     FROM ${WINDOW_FROM}
     JOIN users u ON u.id = av.teacher_id
     WHERE ${OCCURS_IN_RANGE('$1', '$2')}
       AND u.approval_status = 'approved'
       AND EXISTS (
         SELECT 1 FROM teacher_rates r
         WHERE r.teacher_id = av.teacher_id AND r.modality = av.modality
       )
     ORDER BY av.start_time, u.nombre, u.apellido`,
    [from, to]
  );
  return result.rows;
}

/**
 * Una ventana con el nombre del docente, o null. Para reservar: la tarifa de
 * la materia elegida se busca aparte (findRate), no hace falta la lista.
 *
 * Trae el estado de aprobación del docente: quien tenga el id de una ventana
 * de un docente no aprobado no tiene que poder reservarla igual.
 *
 * @param {string} id - body.windowId de POST /api/classes o de POST /api/classes/:id/reschedule.
 * @returns {Promise<object|null>} WINDOW_COLUMNS + teacherName,
 *   teacherApprovalStatus, teacherAcceptsRewards.
 * Origen: availability + teacher_addresses + users.
 * Lo usa: routes/classes/index.js (reservar y reprogramar).
 */
export async function findWindowById(id) {
  const result = await getPool().query(
    `SELECT ${WINDOW_COLUMNS},
            u.nombre || ' ' || u.apellido AS "teacherName",
            u.approval_status AS "teacherApprovalStatus",
            u.accepts_neurona_rewards AS "teacherAcceptsRewards"
     FROM ${WINDOW_FROM}
     JOIN users u ON u.id = av.teacher_id
     WHERE av.id = $1`,
    [id]
  );
  return result.rows[0] ?? null;
}

/**
 * La primera ventana del docente que se pisa con esta en ALGUNA fecha. Con la
 * repetición semanal eso depende de qué se repite:
 *   - las dos semanales del mismo día de la semana: se cruzan tarde o temprano;
 *   - una semanal y una suelta: si la suelta cae después de que arranque la
 *     semanal;
 *   - las dos sueltas: si son el mismo día.
 * Tocarse en el borde NO es pisarse: 13:00-14:00 y 14:00-15:00 conviven.
 *
 * Solo cuentan las fechas desde hoy ($7): lo que ya pasó no se puede volver a
 * dar. Si no, una suelta vieja impediría editar una semanal que arrancó antes
 * que ella (al editar, la fecha de la semanal puede estar en el pasado). Una
 * suelta nueva o editada nunca cae antes de hoy (validateWindow), así que
 * para ella el recorte no cambia nada.
 *
 * @param {pg.PoolClient} client - transacción con el lock del docente tomado.
 * @param {string} teacherId - docente dueño.
 * @param {object} window - ventana ya validada (date, repeatsWeekly, start, end).
 * @param {string|null} excludeId - la propia ventana al editar (null al crear).
 * @returns {Promise<{start, end, repeatsWeekly}|null>} la que se pisa, para el mensaje.
 */
async function findOverlappingWindow(client, teacherId, window, excludeId) {
  const result = await client.query(
    `SELECT to_char(start_time, 'HH24:MI') AS start,
            to_char(end_time, 'HH24:MI') AS "end",
            repeats_weekly AS "repeatsWeekly"
     FROM availability
     WHERE teacher_id = $1
       AND ($2::uuid IS NULL OR id <> $2::uuid)
       AND EXTRACT(ISODOW FROM start_date) = EXTRACT(ISODOW FROM $3::date)
       AND start_time < $6::time AND end_time > $5::time
       AND (repeats_weekly OR start_date >= $7::date)
       AND CASE
         WHEN repeats_weekly AND $4::boolean THEN true
         WHEN repeats_weekly THEN start_date <= $3::date
         WHEN $4::boolean THEN start_date >= GREATEST($3::date, $7::date)
         ELSE start_date = $3::date
       END
     LIMIT 1`,
    [
      teacherId,
      excludeId,
      window.date,
      window.repeatsWeekly,
      window.start,
      window.end,
      todayIso(),
    ]
  );
  return result.rows[0] ?? null;
}

/** El texto del 409 de superposición, para el docente. */
function overlapMessage(other) {
  const semanal = other.repeatsWeekly ? ', que se repite todas las semanas' : '';
  return `Se pisa con otra clase tuya de ${other.start} a ${other.end}${semanal}.`;
}

/**
 * Corre `work` en una transacción con el docente bloqueado: dos pestañas
 * guardando a la vez podrían pasar las dos el chequeo de superposición antes
 * de que cualquiera inserte. Toma también el lock de sus direcciones (en el
 * orden de lockAddresses), porque guardar una ventana puede crear una. Los
 * locks se sueltan solos al terminar la transacción.
 *
 * Hace ROLLBACK (sin tirar) si `work` devuelve null, { conflict } o { invalid },
 * así una dirección creada en el camino no queda guardada.
 *
 * @returns {Promise<*>} lo que devuelva `work`.
 * Locks/transacción: lockAddresses ('availability:' y después 'addresses:').
 */
async function withTeacherLock(teacherId, work) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockAddresses(client, teacherId);
    const result = await work(client);
    const rollback = result === null || result?.conflict || result?.invalid;
    await client.query(rollback ? 'ROLLBACK' : 'COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Re-lee la ventana recién guardada con la misma forma que findTeacherWindows. */
async function selectWindow(client, id) {
  const result = await client.query(
    `SELECT ${WINDOW_COLUMNS}
     FROM ${WINDOW_FROM}
     WHERE av.id = $1`,
    [id]
  );
  return result.rows[0];
}

const ADDRESS_GONE = {
  message: 'Esa dirección ya no existe. Elegí otra.',
  fields: { addressId: 'invalid' },
};

/**
 * El address_id que va a tener la ventana, o { invalid }. La ventana viene de
 * validateWindow con una de tres cosas:
 *   - nada (virtual): sin dirección;
 *   - `newAddress`: se crea acá, guardada o suelta según `saveAddress`;
 *   - `addressId`: una guardada del docente, o la suelta que ya tenía esta
 *     misma ventana (`currentAddressId`, al editar).
 *
 * @returns {Promise<{addressId: string|null}|{invalid: object}>}
 * Origen: teacher_addresses (lee o inserta vía insertAddress).
 */
async function resolveAddress(client, teacherId, window, currentAddressId = null) {
  if (window.modality === 'virtual') return { addressId: null };
  if (window.newAddress) {
    const id = await insertAddress(client, teacherId, window.newAddress, {
      saved: window.saveAddress,
    });
    return { addressId: id };
  }
  const result = await client.query(
    `SELECT 1 FROM teacher_addresses
     WHERE id = $1 AND teacher_id = $2 AND (saved OR id = $3)`,
    [window.addressId, teacherId, currentAddressId]
  );
  return result.rowCount > 0 ? { addressId: window.addressId } : { invalid: ADDRESS_GONE };
}

/**
 * Las direcciones sueltas (no guardadas) que ya no usa ninguna ventana: eran
 * de una sola ventana, que se borró, pasó a virtual o eligió otra.
 */
async function deleteOrphanAddresses(client, teacherId) {
  await client.query(
    `DELETE FROM teacher_addresses ta
     WHERE ta.teacher_id = $1 AND NOT ta.saved
       AND NOT EXISTS (SELECT 1 FROM availability av WHERE av.address_id = ta.id)`,
    [teacherId]
  );
}

const WINDOW_VALUES = (w, addressId) => [
  w.date,
  w.repeatsWeekly,
  w.start,
  w.end,
  w.modality,
  w.maxStudents,
  w.meetingUrl,
  addressId,
];

/**
 * Crea una ventana. { window }, { conflict } o { invalid } con el mensaje
 * para el docente.
 *
 * @param {string} teacherId - request.user.id.
 * @param {object} window - body de POST /api/teachers/me/availability ya
 *   validado por lib/availabilityWindow.js validateWindow (date, repeatsWeekly,
 *   start, end, modality, maxStudents, meetingUrl y addressId | newAddress + saveAddress).
 * @returns {Promise<{window: object}|{conflict: string}|{invalid: object}>}
 *   window con la forma de findTeacherWindows.
 * Origen: INSERT en availability (y quizá en teacher_addresses).
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: withTeacherLock.
 */
export async function createWindow(teacherId, window) {
  return withTeacherLock(teacherId, async (client) => {
    const other = await findOverlappingWindow(client, teacherId, window, null);
    if (other) return { conflict: overlapMessage(other) };

    const address = await resolveAddress(client, teacherId, window);
    if (address.invalid) return address;

    const result = await client.query(
      `INSERT INTO availability (
         teacher_id, start_date, repeats_weekly, start_time, end_time,
         modality, max_students, meeting_url, address_id
       )
       VALUES ($1, $2::date, $3, $4::time, $5::time, $6::class_modality, $7, $8, $9)
       RETURNING id`,
      [teacherId, ...WINDOW_VALUES(window, address.addressId)]
    );
    return { window: await selectWindow(client, result.rows[0].id) };
  });
}

/**
 * { window }, { conflict }, { invalid }, o null si no existe o no es de este
 * docente — las dos cosas se contestan igual, para no confirmar ids ajenos.
 *
 * Ojo: esto NO toca las clases ya reservadas. Si el docente achica o cambia
 * una ventana que alguien ya tenía tomada, esa clase sigue en pie con lo que
 * se copió al reservarla (la dirección incluida).
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de PUT /api/teachers/me/availability/:id.
 * @param {object} window - body ya validado por validateWindow (como en createWindow).
 * @returns {Promise<{window}|{conflict}|{invalid}|null>}
 * Origen: UPDATE availability; borra direcciones sueltas huérfanas.
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: withTeacherLock.
 */
export async function updateWindow(teacherId, id, window) {
  return withTeacherLock(teacherId, async (client) => {
    const existing = await client.query(
      `SELECT address_id AS "addressId" FROM availability WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId]
    );
    if (existing.rowCount === 0) return null;

    const other = await findOverlappingWindow(client, teacherId, window, id);
    if (other) return { conflict: overlapMessage(other) };

    const address = await resolveAddress(client, teacherId, window, existing.rows[0].addressId);
    if (address.invalid) return address;

    await client.query(
      `UPDATE availability SET
         start_date = $3::date, repeats_weekly = $4, start_time = $5::time, end_time = $6::time,
         modality = $7::class_modality, max_students = $8, meeting_url = $9, address_id = $10
       WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId, ...WINDOW_VALUES(window, address.addressId)]
    );
    await deleteOrphanAddresses(client, teacherId);
    return { window: await selectWindow(client, id) };
  });
}

/**
 * Borra una ventana del docente. true si se borró. Las clases ya reservadas
 * quedan (ver updateWindow).
 *
 * @param {string} teacherId - request.user.id.
 * @param {string} id - params.id de DELETE /api/teachers/me/availability/:id.
 * @returns {Promise<boolean>}
 * Origen: DELETE en availability; borra direcciones sueltas huérfanas.
 * Lo usa: routes/teachers/index.js.
 * Locks/transacción: withTeacherLock.
 */
export async function deleteWindow(teacherId, id) {
  const result = await withTeacherLock(teacherId, async (client) => {
    const deleted = await client.query(
      `DELETE FROM availability WHERE id = $1 AND teacher_id = $2`,
      [id, teacherId]
    );
    if (deleted.rowCount === 0) return null;
    await deleteOrphanAddresses(client, teacherId);
    return { deleted: true };
  });
  return Boolean(result);
}

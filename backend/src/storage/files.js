import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { contentDisposition } from '../lib/classMaterials.js';

// Los archivos del material de las clases, en un bucket S3. En producción es
// Backblaze B2 (el bucket privado pid-tddlovers) y en local es MinIO, que
// levanta docker-compose.dev.yml: la API es la misma, cambian las variables.
// Nunca se apunta el entorno local al bucket de B2.
//
// Postgres guarda solo la clave de cada objeto (class_material_files); los
// bytes van y vienen acá. Es entrada/salida como db/*, así que los tests de
// las rutas lo mockean igual.

// Cuánto vale un link de descarga. Corto: se pide al tocar "Descargar", y
// si alguien lo copia deja de servir enseguida.
const DOWNLOAD_LINK_SECONDS = 5 * 60;

let clients = null;

function config() {
  const {
    S3_ENDPOINT,
    S3_PUBLIC_ENDPOINT,
    S3_REGION,
    S3_BUCKET,
    S3_ACCESS_KEY_ID,
    S3_SECRET_ACCESS_KEY,
  } = process.env;
  if (!S3_ENDPOINT || !S3_REGION || !S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    endpoint: S3_ENDPOINT,
    // Solo en dev: el backend le habla a MinIO por la red de compose
    // (http://minio:9000), pero el navegador lo ve en 127.0.0.1:9000. La
    // firma del link incluye el host, así que se firma con el que va a usar
    // el navegador. En producción es el mismo endpoint.
    publicEndpoint: S3_PUBLIC_ENDPOINT || S3_ENDPOINT,
    region: S3_REGION,
    bucket: S3_BUCKET,
    credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  };
}

function getClients() {
  if (clients) return clients;
  const cfg = config();
  if (!cfg) return null;
  // forcePathStyle: bucket en la ruta (host/bucket/clave) y no en el
  // subdominio. MinIO lo necesita y B2 lo acepta.
  const base = { region: cfg.region, credentials: cfg.credentials, forcePathStyle: true };
  clients = {
    bucket: cfg.bucket,
    internal: new S3Client({ ...base, endpoint: cfg.endpoint }),
    // Firmar no hace ningún pedido: este cliente solo arma links.
    public: new S3Client({ ...base, endpoint: cfg.publicEndpoint }),
  };
  return clients;
}

/** Si están las variables del bucket. Sin ellas, las rutas de archivos responden 503. */
export function isConfigured() {
  return getClients() !== null;
}

/**
 * La clave de un archivo nuevo: agrupada por turno para poder mirarlo en la
 * consola del bucket, y con un id al final. Sin el nombre del archivo, que
 * puede traer cualquier cosa: el nombre real va en la base y en la descarga.
 */
export function newFileKey({ teacherId, date, startTime }, id) {
  return `materials/${teacherId}/${date}/${startTime.replace(':', '')}/${id}`;
}

export async function putFile(key, data, mimeType) {
  const { internal, bucket } = getClients();
  await internal.send(
    new PutObjectCommand({ Bucket: bucket, Key: key, Body: data, ContentType: mimeType })
  );
}

/**
 * Borra los objetos. Si falla no corta nada (la fila ya se borró, o la
 * subida ya falló por otro lado): queda un objeto huérfano en el bucket, que
 * ocupa lugar pero nadie puede pedir.
 */
export async function deleteFiles(keys, log = console) {
  if (keys.length === 0) return;
  const { internal, bucket } = getClients();
  try {
    await internal.send(
      new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
      })
    );
  } catch (err) {
    log.error({ err, keys }, 'No se pudieron borrar archivos del bucket');
  }
}

/**
 * Un link para bajar el archivo directo del bucket, válido por unos minutos.
 * El nombre real y si se muestra o se descarga van en el link (los response-*
 * de S3), con la misma regla que antes servía el backend: solo las imágenes
 * comunes se muestran, todo lo demás se descarga.
 */
export async function signedDownloadUrl(key, { filename, mimeType }) {
  const { public: signer, bucket } = getClients();
  return getSignedUrl(
    signer,
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ResponseContentType: mimeType,
      ResponseContentDisposition: contentDisposition(filename, mimeType),
      ResponseCacheControl: 'private, no-store',
    }),
    { expiresIn: DOWNLOAD_LINK_SECONDS }
  );
}

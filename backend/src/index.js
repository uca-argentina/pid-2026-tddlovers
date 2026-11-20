// Punto de entrada del backend (`node src/index.js`, ver package.json): carga
// las variables de .env (dotenv), arma la app con buildApp() de app.js, la pone
// a escuchar en el puerto y se encarga del apagado ordenado. Los tests NO pasan
// por acá: usan buildApp() + app.inject() sin abrir un puerto.
import 'dotenv/config';
import { buildApp } from './app.js';
import { closePool } from './db/pool.js';

const app = buildApp();

// Render asigna el puerto en PORT y solo enruta tráfico a ese; en local y en
// Docker no se setea y queda el 4000 de siempre.
const port = Number(process.env.PORT) || 4000;

app.listen({ port, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

/**
 * Apaga el proceso ordenadamente: cierra Fastify (deja terminar los pedidos en
 * curso) y después el pool de Postgres (closePool de db/pool.js), y sale con 0,
 * o con 1 si algo falló al cerrar.
 *
 * Docker manda SIGTERM en `stop`/`down` y mata el proceso a la fuerza si no
 * termina en el tiempo de gracia. Primero el servidor HTTP y después la base,
 * así ninguna conexión se corta en medio de una consulta.
 *
 * @param {string} signal - 'SIGTERM' o 'SIGINT'; solo se usa para el log.
 * Lo usan: los process.on de abajo.
 */
async function shutdown(signal) {
  app.log.info({ signal }, 'shutting down');
  try {
    await app.close();
    await closePool();
    process.exit(0);
  } catch (err) {
    app.log.error(err, 'error during shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

import 'dotenv/config';
import { buildApp } from './app.js';
import { closePool } from './db/pool.js';

const app = buildApp();

app.listen({ port: 4000, host: '0.0.0.0' }, (err) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
});

// Docker manda SIGTERM en `stop`/`down` y mata el proceso a la fuerza si no
// termina en el tiempo de gracia. Primero se cierra el servidor HTTP para que
// los pedidos en curso terminen, y después el pool de la base, así ninguna
// conexión se corta en medio de una consulta.
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

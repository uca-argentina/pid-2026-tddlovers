import 'dotenv/config';
import { createUser, findUserByEmail } from '../db/users.js';
import { closePool } from '../db/pool.js';
import { checkPasswordStrength, hashPassword } from '../lib/password.js';

// Crea una cuenta de administrador. No hay registro para admins a propósito
// (el registro solo acepta teacher/student): un admin decide quién aparece en
// la app, así que se crea a mano, desde adentro del contenedor:
//
//   docker compose -f docker-compose.dev.yml exec backend \
//     npm run create-admin -- admin@ejemplo.com 'Contraseña-Segura1' Nombre Apellido

async function main() {
  const [email, password, nombre = 'Admin', apellido = 'BookIt'] = process.argv.slice(2);

  if (!email || !password) {
    console.error('Uso: npm run create-admin -- <email> <contraseña> [nombre] [apellido]');
    return 1;
  }

  const weak = checkPasswordStrength(password);
  if (weak) {
    console.error(weak);
    return 1;
  }

  const normalizedEmail = email.toLowerCase();
  if (await findUserByEmail(normalizedEmail)) {
    console.error(`Ya existe una cuenta con ${normalizedEmail}.`);
    return 1;
  }

  const user = await createUser({
    email: normalizedEmail,
    passwordHash: await hashPassword(password),
    role: 'admin',
    nombre,
    apellido,
    telefono: null,
  });
  console.log(`Listo: ${user.email} es administrador.`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closePool());

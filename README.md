# TDD Lovers

Aplicación web que conecta estudiantes y docentes. Frontend en React (Vite) y backend en Fastify, dockerizados con PostgreSQL.

## Levantar

Crear el `.env` local:

```
cp .env.example.dev .env
```

Los valores por defecto ya sirven para desarrollo local — no hace falta editarlos, a menos que quieras cambiarlos.

Levantar contenedores:

```
docker compose -f docker-compose.dev.yml up --build
```

La app queda en:

```
Frontend: http://localhost:5173
Backend:  http://localhost:4000
```

Si se cambia el `.env` con Docker ya levantado, recrear los contenedores:

```
docker compose -f docker-compose.dev.yml up -d --force-recreate backend frontend
```


## Consideraciones

* No subir `.env` a Git.
* `.env.example` es solo una plantilla.
* PostgreSQL expone el puerto 5432 al host en desarrollo local, para poder inspeccionar la base con un cliente (DBeaver, TablePlus, etc.). En producción no se expone.
* El servicio `backend` es Fastify; el servicio `frontend` es React servido por Vite en desarrollo.

## Producción

* **Frontend**: Render, *Static Site* definido en el mismo `render.yaml`.
* **Backend**: Render, *Web Service* definido en `render.yaml` (Blueprint), región Virginia. En el plan gratuito se duerme tras ~15 min sin uso y el primer pedido tarda ~1 minuto.
* **Base**: Neon, región `aws-us-east-1` (la misma que el backend).

El navegador nunca habla directo con el backend: el sitio estático reenvía `/api/*` al backend (rewrite en `render.yaml`), así la app y la API comparten origen y la cookie de sesión funciona sin CORS. Si cambia la URL del backend en Render, hay que actualizarla ahí.

Despliegue: Render despliega los dos automáticamente al mergear a `main`, una vez que pasan los tests de GitHub Actions.

Variables del backend en Render:

* `DATABASE_URL`: cadena *pooled* de Neon (host con `-pooler`), con `?sslmode=require`.
* `COOKIE_SECRET`: la genera Render.
* `NODE_ENV=production`: marca la cookie de sesión como `secure`.

### Migraciones en Neon

En Neon no corre `docker-entrypoint-initdb.d`, así que se aplican a mano, con la cadena **directa** (sin `-pooler`). En la base nueva, todas en orden:

```
for f in backend/migrations/*.sql; do psql "$NEON_DIRECT_URL" -v ON_ERROR_STOP=1 -f "$f"; done
```

Después, cada migración nueva se aplica una vez, igual que en las bases locales: `psql "$NEON_DIRECT_URL" -f backend/migrations/0NN_*.sql`.

## Estructura

```
pid-2026-tddlovers/
  frontend/     React + Vite
  backend/      Fastify
  docker-compose.dev.yml   desarrollo local
  render.yaml              backend y frontend en Render
  .env.example
```

## Flujo de Git

* Rama por feature, PR hacia `main`.
* CI corre tests automáticamente en push a `main`, según la carpeta modificada (`frontend/**` o `backend/**`).


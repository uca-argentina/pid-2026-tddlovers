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
* El servicio `backend` es Fastify; el servicio `frontend` es React servido por Vite en desarrollo (por nginx en producción).

## Estructura

```
pid-2026-tddlovers/
  frontend/     React + Vite
  backend/      Fastify
  docker-compose.dev.yml   desarrollo local
  docker-compose.yml       producción (pendiente hasta tener el VPS)
  Caddyfile
  .env.example
```

## Flujo de Git

* Rama por feature, PR hacia `main`.
* CI corre tests automáticamente en push a `main`, según la carpeta modificada (`frontend/**` o `backend/**`).


# API UTM Desk

API REST con Node.js, Express, TypeScript, Zod, JWT, bcrypt y el driver oficial de MongoDB.

## Preparación

Configura `.env` en la raíz del repositorio con `MONGODB_URI`, `MONGODB_DB_NAME` y `JWT_SECRET` (mínimo 32 caracteres). El backend carga ese archivo independientemente de la carpeta de ejecución.

El almacenamiento de evidencias es opcional; requiere `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_BUCKET`. La service-role key solo debe existir en el servidor. La API acepta JPG, PNG y PDF de hasta 10 MB, con un máximo de cinco evidencias por reporte.

Instala dependencias e inicia el backend desde esta carpeta:

```powershell
npm ci
npm run dev
```

La API escucha en `http://localhost:3000`.

## Autenticación y rutas

- `GET /health`: estado de MongoDB y disponibilidad de almacenamiento.
- `POST /api/auth/login`: valida correo y contraseña de una cuenta activa, y devuelve JWT.
- `GET /api/auth/me`: perfil actual.
- Las demás rutas `/api/*` requieren `Authorization: Bearer <token>`.
- Los cambios de estado requieren perfil técnico o administrador; `/api/admin/*` requiere administrador.
- Seguimientos, comentarios, moderación y evidencias se guardan en colecciones/documentos del servidor, no en `localStorage`.

## Comprobaciones

```powershell
npm run build
npm run test:api
```

El smoke test requiere la API conectada a MongoDB. Comprueba salud, rutas protegidas sin token y rechazo de credenciales inexistentes sin crear o modificar incidencias. Para probar login y lecturas autenticadas, define `SMOKE_USER_EMAIL` y `SMOKE_USER_PASSWORD` en la terminal; esa prueba adicional también es de solo lectura.

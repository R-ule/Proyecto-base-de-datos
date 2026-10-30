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
- `POST /api/auth/register`: crea una cuenta de reportante, rechaza correos duplicados y devuelve una sesión JWT. No acepta perfiles privilegiados.
- `GET /api/auth/me`: perfil actual.
- Las demás rutas `/api/*` requieren `Authorization: Bearer <token>`.
- Los cambios de estado requieren perfil técnico o administrador. `/api/admin/*` requiere administrador, y `/api/moderacion/*` permite a auditores y administradores consultar las métricas y atender la cola, sin acceso a la gestión de usuarios.
- Administradores y superadministradores asignan al supervisor responsable y al técnico; el técnico puede tomar una tarea libre para sí mismo. La API valida los perfiles de cada asignación y evita que un administrador quede como técnico.
- Seguimientos, comentarios, moderación y evidencias se guardan en colecciones/documentos del servidor, no en `localStorage`.

El registro exige contraseña de 6 a 8 caracteres. Para el correo admite únicamente letras, números, puntos y `@`, con un dominio válido. El login no limita el máximo de caracteres para mantener el acceso a cuentas existentes.

Administración puede asignar los perfiles `reportante`, `tecnico`, `administrador` y `auditor`. Auditor conserva las funciones de reportante y añade acceso a Moderación; no puede usar los endpoints administrativos.

## Comprobaciones

```powershell
npm run build
npm run test:api
```

El smoke test requiere la API conectada a MongoDB. Comprueba salud, rutas protegidas sin token y rechazo de credenciales inexistentes sin crear o modificar incidencias. Para probar login y lecturas autenticadas, define `SMOKE_USER_EMAIL` y `SMOKE_USER_PASSWORD` en la terminal; esa prueba adicional también es de solo lectura.

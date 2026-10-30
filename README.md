# UTM Desk

Proyecto organizado en tres módulos independientes:

- `Frontend/`: aplicación Angular.
- `backend2/`: API REST con Express, TypeScript y MongoDB.
- `database/`: scripts para inicializar y verificar MongoDB Atlas.
- `postman/`: colección de solicitudes HTTP.

## Requisitos

- Node.js 20.19+ y npm.
- MongoDB Atlas configurado para usar la API y los scripts de base de datos.

## Configuración

1. Configura `.env` en la raíz. La API necesita `MONGODB_URI`, `MONGODB_DB_NAME` y un `JWT_SECRET` aleatorio de al menos 32 caracteres. Para despliegues fuera de local, configura también `FRONTEND_ORIGIN`.
2. Para subir evidencias configura `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_BUCKET`; crea el bucket privado correspondiente en Supabase. Si no se configura, la API lo indica en `/health` y desactiva las cargas.
3. No compartas ni subas `.env`; contiene credenciales.
4. Instala dependencias dentro de cada módulo desde sus respectivas carpetas:

   ```powershell
   cd Frontend; npm ci
   cd ..\backend2; npm ci
   cd ..\database; npm ci
   ```

## Ejecución y comprobaciones

En terminales separadas, desde cada carpeta:

```powershell
# Frontend
cd Frontend
npm start
```

```powershell
# API
cd backend2
npm run dev
```

```powershell
# Inicializar/verificar la base de datos cuando corresponda
cd database
npm run seed:dry
npm run verify
```

Con la API y MongoDB disponibles, comprobar llamadas HTTP:

```powershell
cd backend2
npm run test:api
```

La prueba comprueba `/health`, los rechazos de rutas protegidas sin token, validación de registro y rechazo de credenciales inexistentes. Para comprobar también login y lecturas autenticadas, define `SMOKE_USER_EMAIL` y `SMOKE_USER_PASSWORD` en el entorno de la terminal antes de ejecutarla. No crea ni modifica usuarios ni incidencias.

## Estado de integración

El registro público crea cuentas de perfil reportante con contraseña cifrada de 6 a 8 caracteres y después inicia sesión con JWT. El correo acepta letras y números, puntos y un solo `@`, con un dominio válido (por ejemplo, `nombre@correo.com`). El login sigue aceptando contraseñas más largas para no bloquear cuentas ya existentes. El registro rechaza duplicados y no permite elegir perfiles técnicos o administrativos; esos perfiles solo los asigna un administrador.

La aplicación consulta reportes, reportes propios y seguidos; permite crear reportes, cambiar estados, guardar comentarios, seguir reportes y enviar reportes de moderación. Administración consulta indicadores y gestiona usuarios; Moderación tiene sus propias gráficas, cola de revisión, actualización y exportación. El perfil Auditor conserva las pantallas de reportante y puede revisar contenido, pero no administrar usuarios ni entrar al panel administrativo. Las evidencias se guardan en MongoDB y Supabase cuando el almacenamiento está configurado.

Antes de publicar: configura credenciales reales y el bucket privado de Supabase, establece el origen permitido en `FRONTEND_ORIGIN`, valida TLS y configura el dominio de la API en el frontend. El archivo `.env` permanece local e ignorado por Git.

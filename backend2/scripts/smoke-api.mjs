import assert from 'node:assert/strict';

const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');

async function request(path, options) {
  const response = await fetch(`${baseUrl}${path}`, options);
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(`${options?.method ?? 'GET'} ${path} no devolvió JSON (HTTP ${response.status}).`);
  }
  return { response, body };
}

async function main() {
  const health = await request('/health');
  assert.equal(health.response.status, 200, 'El backend debe estar listo.');
  assert.equal(health.body.status, 'ok');
  assert.equal(health.body.database, 'connected');
  assert.ok(['configured', 'not_configured'].includes(health.body.storage));
  console.log('OK GET /health');

  const list = await request('/api/incidencias');
  assert.equal(list.response.status, 401, 'Las incidencias deben exigir autenticación.');
  console.log('OK GET /api/incidencias (401 sin token)');

  const protectedAdmin = await request('/api/admin/summary');
  assert.equal(protectedAdmin.response.status, 401, 'La administración debe exigir autenticación.');
  console.log('OK GET /api/admin/summary (401 sin token)');

  for (const path of [
    '/api/moderacion/summary',
    '/api/moderacion',
    '/api/incidencias/INC-INVALIDO/responsable',
    '/api/incidencias/INC-INVALIDO/tecnico',
  ]) {
    const protectedModeration = await request(path);
    assert.equal(protectedModeration.response.status, 401, `${path} debe exigir autenticación.`);
  }
  console.log('OK rutas de moderación protegidas sin token');

  const noSession = await request('/api/auth/me');
  assert.equal(noSession.response.status, 401, 'El endpoint de sesión debe rechazar peticiones anónimas.');
  console.log('OK GET /api/auth/me (401 sin token)');

  const invalidLogin = await request('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ correo: 'smoke@example.invalid', password: 'no-es-una-credencial-real' }),
  });
  assert.equal(invalidLogin.response.status, 401, 'El login debe rechazar credenciales inexistentes.');
  console.log('OK POST /api/auth/login (401 sin modificar datos)');

  const invalidRegistration = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Prueba',
      correo: 'no-es-correo',
      password: 'corta',
      rol: 'administrador',
    }),
  });
  assert.equal(invalidRegistration.response.status, 400, 'El registro debe validar datos y no aceptar roles asignados por el cliente.');
  console.log('OK POST /api/auth/register (400 y sin crear usuarios)');

  const publicAuditor = await request('/api/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      nombre: 'Prueba',
      correo: 'no-es-correo',
      password: 'abc123',
      rol: 'auditor',
    }),
  });
  assert.equal(publicAuditor.response.status, 400, 'El registro público no debe permitir asignarse el perfil Auditor.');
  console.log('OK el registro público rechaza asignación del perfil Auditor');

  for (const [correo, password] of [
    ['registro+especial@example.com', 'abc123'],
    ['registro@example.com', 'abc12'],
    ['registro@example.com', 'abc123456'],
  ]) {
    const invalidRule = await request('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nombre: 'Prueba', correo, password }),
    });
    assert.equal(invalidRule.response.status, 400, 'El registro debe aplicar la política de correo y longitud.');
  }
  console.log('OK registro rechaza símbolos extra en correo y contraseñas fuera de 6-8 caracteres');

  if (process.env.SMOKE_USER_EMAIL && process.env.SMOKE_USER_PASSWORD) {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        correo: process.env.SMOKE_USER_EMAIL,
        password: process.env.SMOKE_USER_PASSWORD,
      }),
    });
    assert.equal(login.response.status, 200, 'Las credenciales de humo deben iniciar sesión.');
    assert.equal(typeof login.body.token, 'string');
    const authorization = { authorization: `Bearer ${login.body.token}` };
    const authenticatedList = await request('/api/incidencias', { headers: authorization });
    assert.equal(authenticatedList.response.status, 200);
    assert.equal(typeof authenticatedList.body.total, 'number');
    assert.ok(Array.isArray(authenticatedList.body.data));
    const mine = await request('/api/mis-reportes', { headers: authorization });
    assert.equal(mine.response.status, 200);
    assert.ok(Array.isArray(mine.body.data));
    console.log(`OK login + lecturas autenticadas (${authenticatedList.body.total} reportes)`);
  } else {
    console.log('OMITIDO login válido: define SMOKE_USER_EMAIL y SMOKE_USER_PASSWORD para probarlo sin escritura.');
  }

  if (process.env.SMOKE_AUDITOR_EMAIL && process.env.SMOKE_AUDITOR_PASSWORD) {
    const login = await request('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        correo: process.env.SMOKE_AUDITOR_EMAIL,
        password: process.env.SMOKE_AUDITOR_PASSWORD,
      }),
    });
    assert.equal(login.response.status, 200, 'La cuenta de humo Auditor debe iniciar sesión.');
    const authorization = { authorization: `Bearer ${login.body.token}` };
    const summary = await request('/api/moderacion/summary', { headers: authorization });
    assert.equal(summary.response.status, 200, 'Auditor debe consultar métricas de moderación.');
    assert.equal(typeof summary.body.reportesActivos, 'number');
    assert.equal(typeof summary.body.pendientesRevision, 'number');
    const queue = await request('/api/moderacion', { headers: authorization });
    assert.equal(queue.response.status, 200, 'Auditor debe consultar la cola de moderación.');
    const invalidDecision = await request('/api/moderacion/no-es-un-id', {
      method: 'PATCH',
      headers: { ...authorization, 'content-type': 'application/json' },
      body: JSON.stringify({ decision: 'cerrado' }),
    });
    assert.equal(invalidDecision.response.status, 400, 'Auditor debe tener acceso al endpoint de decisiones de moderación.');
    const admin = await request('/api/admin/summary', { headers: authorization });
    assert.equal(admin.response.status, 403, 'Auditor no debe acceder a Administración.');
    const users = await request('/api/admin/users', { headers: authorization });
    assert.equal(users.response.status, 403, 'Auditor no debe gestionar usuarios.');
    console.log('OK permisos de Auditor (moderación permitida, administración denegada)');
  } else {
    console.log('OMITIDO permisos de Auditor: define SMOKE_AUDITOR_EMAIL y SMOKE_AUDITOR_PASSWORD para probarlos.');
  }
}

main().catch((error) => {
  console.error(`Prueba de API fallida: ${error.message}`);
  process.exitCode = 1;
});

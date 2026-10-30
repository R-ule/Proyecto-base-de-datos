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
}

main().catch((error) => {
  console.error(`Prueba de API fallida: ${error.message}`);
  process.exitCode = 1;
});

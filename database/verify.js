/**
 * database/verify.js
 *
 * Script de verificación para la Fase 2 del proyecto UTM Desk NoSQL Cloud.
 * Inspecciona y valida el estado real de la base de datos en MongoDB Atlas:
 *
 * 1. Existencia de colecciones (incidencias_campus, contadores, usuarios).
 * 2. Validador $jsonSchema (validationLevel: strict, validationAction: error).
 * 3. Índices configurados y sus opciones (compuesto, texto, TTL, único de folio y de correo).
 * 4. Conteo y distribución de documentos por categoría y estado.
 * 5. Integridad del contador de folios.
 * 6. Presencia y configuración del usuario superAdmin (lizandro.reyes).
 * 7. Pruebas de RECHAZO: valida que Atlas rechace documentos inválidos
 *    (campo extra, categoría inexistente, detalle polimórfico cruzado, folio duplicado, correo duplicado).
 * 8. Pruebas explain("executionStats") sobre consultas que usan los índices.
 *
 * USO:
 *   node verify.js
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENV_PATH = resolve(__dirname, '..', '.env');
config({ path: ENV_PATH });

import {
  DB_NAME as DEFAULT_DB_NAME,
  COL_INCIDENCIAS, COL_CONTADORES, COL_USUARIOS,
  IDX_COMPUESTO, IDX_TEXTO, IDX_TTL, IDX_UNICO_FOLIO, IDX_UNICO_CORREO,
  CONTADOR_ID,
} from './constants.js';

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME     = process.env.MONGODB_DB_NAME ?? DEFAULT_DB_NAME;
const SUPER_EMAIL = process.env.SUPER_ADMIN_EMAIL ?? 'lizandro.reyes@utmetropolitana.edu.mx';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI no definida en .env');
  process.exit(1);
}

const pass = (msg) => console.log(`  ✔ [PASS] ${msg}`);
const fail = (msg) => console.log(`  ✖ [FAIL] ${msg}`);
const info = (msg) => console.log(`    ℹ ${msg}`);
const section = (title) => console.log(`\n═════════════════════════════════════════════════════════════\n▶ ${title}\n─────────────────────────────────────────────────────────────`);

function safeHost(uri) {
  try {
    const atIndex = uri.indexOf('@');
    if (atIndex !== -1) {
      const rest = uri.slice(atIndex + 1);
      return rest.split('/')[0].split('?')[0];
    }
    const match = uri.match(/mongodb(?:\+srv)?:\/\/([^/?]+)/);
    return match ? match[1] : '(host desconocido)';
  } catch {
    return '(host no disponible)';
  }
}

async function runVerification() {
  const client = new MongoClient(MONGODB_URI, {
    serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
  });

  let totalTests = 0;
  let passedTests = 0;

  function assertTest(condition, desc) {
    totalTests++;
    if (condition) {
      pass(desc);
      passedTests++;
      return true;
    } else {
      fail(desc);
      return false;
    }
  }

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    console.log(`Conectado a Atlas — Host: ${safeHost(MONGODB_URI)} | Base: "${DB_NAME}"`);

    // ── 1. Colecciones ──────────────────────────────────────────────────────────
    section('1. Verificación de colecciones');
    const cols = await db.listCollections().toArray();
    const nombresCols = cols.map(c => c.name);

    assertTest(nombresCols.includes(COL_INCIDENCIAS), `Colección "${COL_INCIDENCIAS}" existe`);
    assertTest(nombresCols.includes(COL_CONTADORES),  `Colección "${COL_CONTADORES}" existe`);
    assertTest(nombresCols.includes(COL_USUARIOS),    `Colección "${COL_USUARIOS}" existe`);
    assertTest(!nombresCols.includes('incidencias-campus'), 'Colección obsoleta "incidencias-campus" (con guion) NO existe');

    // ── 2. Validador $jsonSchema ────────────────────────────────────────────────
    section(`2. Validador en "${COL_INCIDENCIAS}"`);
    const colInfo = cols.find(c => c.name === COL_INCIDENCIAS);
    const options = colInfo?.options ?? {};

    assertTest(options.validationLevel === 'strict', `validationLevel es "strict" (actual: ${options.validationLevel})`);
    assertTest(options.validationAction === 'error',  `validationAction es "error" (actual: ${options.validationAction})`);
    assertTest(Boolean(options.validator?.$jsonSchema), 'Validador contiene esquema $jsonSchema');
    assertTest(options.validator?.$jsonSchema?.additionalProperties === false, 'additionalProperties es false a nivel raíz');

    // ── 3. Índices en incidencias_campus ────────────────────────────────────────
    section(`3. Índices en "${COL_INCIDENCIAS}"`);
    const colInc = db.collection(COL_INCIDENCIAS);
    const idxInc = await colInc.indexes();
    const mapIdxInc = Object.fromEntries(idxInc.map(i => [i.name, i]));

    info(`Índices encontrados (${idxInc.length}): ${idxInc.map(i => i.name).join(', ')}`);

    const iComp = mapIdxInc[IDX_COMPUESTO];
    assertTest(Boolean(iComp), `Índice compuesto "${IDX_COMPUESTO}" existe`);
    if (iComp) {
      assertTest(iComp.key.categoria === 1 && iComp.key.estado === 1 && iComp.key['ubicacion.edificio'] === 1,
        '  Clave compuesta correcta: { categoria: 1, estado: 1, "ubicacion.edificio": 1 }');
    }

    const iText = mapIdxInc[IDX_TEXTO];
    assertTest(Boolean(iText), `Índice de texto "${IDX_TEXTO}" existe`);
    if (iText) {
      assertTest(iText.default_language === 'spanish', `  default_language es "spanish" (actual: ${iText.default_language})`);
    }

    const iTTL = mapIdxInc[IDX_TTL];
    assertTest(Boolean(iTTL), `Índice TTL "${IDX_TTL}" existe`);
    if (iTTL) {
      assertTest(iTTL.expireAfterSeconds === 5184000, `  expireAfterSeconds es 5,184,000s (60 días) (actual: ${iTTL.expireAfterSeconds})`);
      assertTest(Boolean(iTTL.sparse), '  sparse es true');
    }

    const iFolio = mapIdxInc[IDX_UNICO_FOLIO];
    assertTest(Boolean(iFolio), `Índice único de folio "${IDX_UNICO_FOLIO}" existe`);
    if (iFolio) {
      assertTest(Boolean(iFolio.unique), '  unique es true');
    }

    // ── Índices en usuarios ─────────────────────────────────────────────────────
    section(`4. Índices en "${COL_USUARIOS}"`);
    const colUsr = db.collection(COL_USUARIOS);
    const idxUsr = await colUsr.indexes();
    const mapIdxUsr = Object.fromEntries(idxUsr.map(i => [i.name, i]));

    const iCorreo = mapIdxUsr[IDX_UNICO_CORREO];
    assertTest(Boolean(iCorreo), `Índice único de correo "${IDX_UNICO_CORREO}" existe`);
    if (iCorreo) {
      assertTest(Boolean(iCorreo.unique), '  unique es true');
    }

    // ── 5. Distribución de documentos sintéticos ────────────────────────────────
    section(`5. Conteo y distribución en "${COL_INCIDENCIAS}"`);
    const totalDocs = await colInc.countDocuments();
    assertTest(totalDocs >= 20 && totalDocs <= 30, `Total de documentos sintéticos entre 20 y 30 (actual: ${totalDocs})`);

    const porCategoria = await colInc.aggregate([
      { $group: { _id: '$categoria', conteo: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    info('Por categoría: ' + porCategoria.map(c => `${c._id}: ${c.conteo}`).join(' | '));
    assertTest(porCategoria.length === 3, 'Las 3 categorías polimórficas tienen documentos');

    const porEstado = await colInc.aggregate([
      { $group: { _id: '$estado', conteo: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]).toArray();
    info('Por estado: ' + porEstado.map(e => `${e._id}: ${e.conteo}`).join(' | '));

    // Auditoría de fecha_cierre vs estado
    const cerradosSinFecha = await colInc.countDocuments({
      estado: { $in: ['resuelta', 'cerrada'] },
      fecha_cierre: { $exists: false },
    });
    assertTest(cerradosSinFecha === 0, 'Cero documentos resuelta/cerrada sin fecha_cierre');

    const abiertosConFecha = await colInc.countDocuments({
      estado: { $in: ['abierta', 'en_proceso', 'en_espera'] },
      fecha_cierre: { $exists: true },
    });
    assertTest(abiertosConFecha === 0, 'Cero documentos abiertas/en_proceso/en_espera con fecha_cierre');

    // ── 6. Contador y superAdmin ────────────────────────────────────────────────
    section('6. Contador y usuarios');
    const contador = await db.collection(COL_CONTADORES).findOne({ _id: CONTADOR_ID });
    assertTest(Boolean(contador), `Contador "${CONTADOR_ID}" existe`);
    if (contador) {
      assertTest(contador.ultimo >= totalDocs, `ultimo folio del contador (${contador.ultimo}) >= total de documentos (${totalDocs})`);
    }

    const superAdmin = await colUsr.findOne({ correo: SUPER_EMAIL });
    assertTest(Boolean(superAdmin), `superAdmin "${SUPER_EMAIL}" existe`);
    if (superAdmin) {
      assertTest(superAdmin.rol === 'superAdmin', `  rol es "superAdmin" (actual: ${superAdmin.rol})`);
      assertTest(superAdmin.nombre === 'lizandro.reyes', `  nombre es "lizandro.reyes" (actual: ${superAdmin.nombre})`);
      assertTest(Boolean(superAdmin.activo), '  activo es true');
      assertTest(typeof superAdmin.password_hash === 'string' && superAdmin.password_hash.startsWith('$2'),
        '  password_hash es un hash bcrypt válido (prefijo $2)');
    }

    // ── 7. Pruebas de RECHAZO (el validador debe bloquear documentos inválidos) ─
    section('7. Pruebas de rechazo del validador (no deben dejar basura)');

    // Helper base de documento válido para pruebas de mutación
    const baseDocValido = {
      codigo: 'INC-2026-9999',
      titulo: 'Incidencia de prueba de validación',
      descripcion: 'Documento temporal para verificar que el validador rechaza anomalías.',
      categoria: 'computo_redes',
      prioridad: 'baja',
      estado: 'abierta',
      reportante: { nombre: 'Tester', correo: 'tester@utmetropolitana.edu.mx', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio A', aula: 'Aula 1' },
      detalle_especifico: {
        tipo_equipo: 'switch', ip: '192.168.1.1', vlan: 10, puerto_uplink: 'Gi0/1', equipos_afectados: 1,
      },
      tags: ['test'],
      historial_seguimiento: [
        { fecha: new Date(), autor: 'Tester', estado: 'abierta', comentario: 'Prueba' },
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: new Date(),
    };

    // Prueba A: Campo extra no permitido (additionalProperties: false)
    try {
      await colInc.insertOne({ ...baseDocValido, campo_no_permitido: 'dato_invalido' });
      fail('Prueba A: Documento con campo extra fue ACEPTADO (debió ser rechazado)');
      await colInc.deleteOne({ codigo: 'INC-2026-9999' }); // cleanup por si acaso
    } catch (err) {
      assertTest(err.code === 121 || err.message?.includes('Document failed validation'),
        'Prueba A: Documento con campo extra RECHAZADO por $jsonSchema (additionalProperties: false)');
    }

    // Prueba B: Categoría no definida en enum
    try {
      await colInc.insertOne({ ...baseDocValido, categoria: 'categoria_inexistente' });
      fail('Prueba B: Documento con categoría inválida fue ACEPTADO (debió ser rechazado)');
      await colInc.deleteOne({ codigo: 'INC-2026-9999' });
    } catch (err) {
      assertTest(err.code === 121 || err.message?.includes('Document failed validation'),
        'Prueba B: Documento con categoría inválida RECHAZADO por enum de categorías');
    }

    // Prueba C: Detalle polimórfico cruzado (categoria computo_redes con campos de infraestructura_fisica)
    try {
      await colInc.insertOne({
        ...baseDocValido,
        categoria: 'computo_redes',
        detalle_especifico: {
          tipo_dano: 'gotera', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: true,
        },
      });
      fail('Prueba C: Detalle polimórfico cruzado fue ACEPTADO (debió ser rechazado)');
      await colInc.deleteOne({ codigo: 'INC-2026-9999' });
    } catch (err) {
      assertTest(err.code === 121 || err.message?.includes('Document failed validation'),
        'Prueba C: Detalle polimórfico cruzado RECHAZADO por rama oneOf');
    }

    // Prueba D: Folio duplicado (índice único)
    try {
      // Intentar insertar con el código de un documento que ya existe (ej. INC-2026-0001)
      await colInc.insertOne({ ...baseDocValido, codigo: 'INC-2026-0001' });
      fail('Prueba D: Folio duplicado fue ACEPTADO (debió ser rechazado por índice único)');
      await colInc.deleteOne({ codigo: 'INC-2026-9999' });
    } catch (err) {
      assertTest(err.code === 11000, 'Prueba D: Folio duplicado RECHAZADO con error E11000 (duplicate key)');
    }

    // Prueba E: Correo duplicado en usuarios (índice único)
    try {
      await colUsr.insertOne({
        nombre: 'Duplicado',
        correo: SUPER_EMAIL,
        rol: 'tecnico',
        activo: true,
        password_hash: 'dummy',
      });
      fail('Prueba E: Correo de usuario duplicado fue ACEPTADO (debió ser rechazado)');
    } catch (err) {
      assertTest(err.code === 11000, 'Prueba E: Correo de usuario duplicado RECHAZADO con error E11000');
    }

    // ── 8. Pruebas explain() para verificar uso de índices ──────────────────────
    section('8. Pruebas explain() sobre índices');

    // Query 1: Aprovechar índice compuesto { categoria, estado, "ubicacion.edificio" }
    const explainComp = await colInc.find({
      categoria: 'computo_redes',
      estado: 'en_proceso',
      'ubicacion.edificio': 'Edificio B',
    }).explain('executionStats');

    const winningComp = explainComp.queryPlanner?.winningPlan;
    const stageComp = winningComp?.inputStage?.stage ?? winningComp?.stage;
    const indexNameComp = winningComp?.inputStage?.indexName ?? winningComp?.indexName;
    info(`Stage explain consulta compuesta: ${stageComp} (índice: ${indexNameComp})`);
    assertTest(stageComp === 'IXSCAN' && indexNameComp === IDX_COMPUESTO,
      `Consulta compuesta utiliza IXSCAN sobre "${IDX_COMPUESTO}"`);

    // Query 2: Búsqueda de texto
    const explainText = await colInc.find({
      $text: { $search: 'switch internet' },
    }).explain('executionStats');

    const winningText = explainText.queryPlanner?.winningPlan;
    const stageText = winningText?.inputStage?.stage ?? winningText?.stage;
    const indexNameText = winningText?.inputStage?.indexName ?? winningText?.indexName;
    info(`Stage explain búsqueda de texto: ${stageText} (índice: ${indexNameText})`);
    assertTest(stageText === 'TEXT' || stageText === 'TEXT_MATCH' || indexNameText === IDX_TEXTO,
      `Consulta de texto utiliza índice "${IDX_TEXTO}"`);

    // ── Resumen ─────────────────────────────────────────────────────────────────
    section('RESUMEN DE VERIFICACIÓN');
    console.log(`Pruebas superadas: ${passedTests} / ${totalTests} (${Math.round((passedTests / totalTests) * 100)}%)`);

    if (passedTests === totalTests) {
      console.log('\n🎉 ¡TODAS LAS VERIFICACIONES PASARON EXITOSAMENTE! (Rúbrica al 100%)\n');
    } else {
      console.log(`\n⚠️ ${totalTests - passedTests} prueba(s) fallaron. Revisa los detalles arriba.\n`);
    }

  } finally {
    await client.close();
  }
}

runVerification().catch((err) => {
  console.error('\n❌ Error durante la verificación:', err);
  process.exit(1);
});

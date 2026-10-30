/**
 * database/script_maestro.js
 *
 * Script idempotente de configuración de la base de datos utm_desk en Atlas.
 * Usa el driver oficial de MongoDB para Node.js y bcryptjs.
 *
 * USO:
 *   node script_maestro.js                  ← ejecuta contra Atlas
 *   node script_maestro.js --dry-run        ← muestra lo que haría, sin escribir
 *   node script_maestro.js --reset-admin-password  ← solo actualiza el hash del superAdmin
 *
 * ARCHIVO .env:
 *   Se carga desde la RAÍZ DEL REPO (un nivel arriba de database/).
 *   Ruta explícita: <repo>/.env
 *   Variables requeridas: MONGODB_URI, MONGODB_DB_NAME (default: utm_desk),
 *     SUPER_ADMIN_EMAIL, SUPER_ADMIN_PASSWORD, SEED_USER_PASSWORD
 *
 * GARANTÍAS DE IDEMPOTENCIA:
 *   - No hace drop de ninguna colección.
 *   - listCollections → createCollection o collMod según exista o no.
 *   - Índices nombrados explícitamente; si hay colisión de nombre: drop + recrear.
 *   - Documentos sintéticos: upsert con $setOnInsert por "codigo" (no pisa ediciones).
 *   - Usuarios de prueba: upsert con $setOnInsert por "correo" (no pisa contraseñas).
 *   - superAdmin: $setOnInsert en primera inserción. Contraseña solo con --reset-admin-password.
 *   - Contador: $max sobre "ultimo" → nunca baja; no choca con folios del backend.
 *
 * SEGURIDAD:
 *   - MONGODB_URI nunca aparece en logs. Solo se muestra el host (sin credenciales).
 *   - Contraseñas y hashes nunca se imprimen.
 */

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';
import bcrypt from 'bcryptjs';

// ── Ruta explícita al .env de la raíz del repo ───────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * El .env vive en la RAÍZ del repo, compartido con el backend.
 * Esta ruta es absoluta y no depende de desde dónde se ejecute node.
 */
const ENV_PATH = resolve(__dirname, '..', '.env');
const { error: envError } = config({ path: ENV_PATH });

// ── Flags CLI ─────────────────────────────────────────────────────────────────
const DRY_RUN         = process.argv.includes('--dry-run');
const RESET_ADMIN_PW  = process.argv.includes('--reset-admin-password');
const RESEED          = process.argv.includes('--reseed');

if (DRY_RUN) {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  MODO DRY-RUN — no se escribe en Atlas  ║');
  console.log('╚══════════════════════════════════════════╝\n');
}

// ── Importar constantes (fuente de verdad) ────────────────────────────────────
import {
  DB_NAME as DEFAULT_DB_NAME,
  CATEGORIAS, ESTADOS, ESTADOS_CERRADOS, PRIORIDADES, ROLES, TIPOS_REPORTANTE,
  COL_INCIDENCIAS, COL_CONTADORES, COL_USUARIOS,
  IDX_COMPUESTO, IDX_TEXTO, IDX_TTL, IDX_UNICO_FOLIO, IDX_UNICO_CORREO,
  TTL_SEGUNDOS, CONTADOR_ID, FOLIO_ANIO, FOLIO_PATTERN,
} from './constants.js';

// ── Variables de entorno ──────────────────────────────────────────────────────
const MONGODB_URI   = process.env.MONGODB_URI;
/** Leída de MONGODB_DB_NAME en .env; si no está definida, usa el default de constants.js */
const DB_NAME       = process.env.MONGODB_DB_NAME ?? DEFAULT_DB_NAME;
/** Correo del superAdmin. En dry-run muestra el valor del documento oficial. */
const SUPER_EMAIL   = process.env.SUPER_ADMIN_EMAIL ?? 'lizandro.reyes@utmetropolitana.edu.mx';
const SUPER_PASSWORD = process.env.SUPER_ADMIN_PASSWORD;
const SEED_PASSWORD  = process.env.SEED_USER_PASSWORD;

// Validaciones: en dry-run no se conecta, pero sí se genera el plan completo
if (!DRY_RUN && !MONGODB_URI)    throw new Error('MONGODB_URI no definida en .env');
if (!DRY_RUN && !SUPER_PASSWORD) throw new Error('SUPER_ADMIN_PASSWORD no definida en .env');
if (!DRY_RUN && !SEED_PASSWORD)  throw new Error('SEED_USER_PASSWORD no definida en .env');
if (RESET_ADMIN_PW && !DRY_RUN && !SUPER_PASSWORD)
  throw new Error('SUPER_ADMIN_PASSWORD requerida para --reset-admin-password');

// ── Helpers ───────────────────────────────────────────────────────────────────
const log     = (msg) => console.log(`  ✔ ${msg}`);
const warn    = (msg) => console.warn(`  ⚠ ${msg}`);
const dry     = (msg) => console.log(`  [DRY-RUN] ${msg}`);
const info    = (msg) => console.log(DRY_RUN ? `  [DRY-RUN] ${msg}` : `  ${msg}`);
const section = (title) => console.log(`\n▶ ${title}`);

/**
 * Extrae el host de la URI de Atlas sin credenciales.
 * Nunca imprime usuario ni contraseña.
 * Ejemplo: "cluster0.abcde.mongodb.net"
 */
function safeHost(uri) {
  if (!uri) return '(MONGODB_URI no disponible en dry-run)';
  try {
    const atIndex = uri.indexOf('@');
    if (atIndex !== -1) {
      const rest = uri.slice(atIndex + 1);
      return rest.split('/')[0].split('?')[0];
    }
    const match = uri.match(/mongodb(?:\+srv)?:\/\/([^/?]+)/);
    return match ? match[1] : '(host desconocido)';
  } catch {
    return '(host no parseable)';
  }
}

// ── Validador $jsonSchema ─────────────────────────────────────────────────────

/**
 * Construye una rama del oneOf polimórfico.
 * Discrimina por "categoria" (enum de un solo valor) y restringe
 * additionalProperties en el subdocumento detalle_especifico.
 */
function ramaCategoria(catValor, detalleProps, detalleRequired) {
  return {
    properties: {
      categoria: { enum: [catValor] },
      detalle_especifico: {
        bsonType: 'object',
        required: detalleRequired,
        additionalProperties: false,
        properties: detalleProps,
      },
    },
  };
}

const txt  = { bsonType: 'string' };
const num  = { bsonType: ['int', 'double'], minimum: 0 };
const fch  = { bsonType: 'date' };
const bool = { bsonType: 'bool' };

const VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',

    // Campos obligatorios en TODOS los documentos
    required: [
      '_id', 'codigo', 'titulo', 'descripcion', 'categoria', 'prioridad',
      'estado', 'reportante', 'ubicacion', 'detalle_especifico',
      'tags', 'historial_seguimiento', 'evidencias', 'horas_invertidas',
      'fecha_creacion',
    ],

    // Todos los campos permitidos a nivel raíz se declaran aquí.
    // additionalProperties:false rechaza cualquier campo no listado.
    additionalProperties: false,

    properties: {
      _id: {},   // ObjectId o string; sin restricción de tipo para compatibilidad

      codigo: {
        bsonType: 'string',
        pattern: FOLIO_PATTERN,
        description: 'Folio único. Formato INC-AAAA-NNNN. Índice único.',
      },
      titulo:      { ...txt, description: 'Título breve de la incidencia.' },
      descripcion: { ...txt, description: 'Descripción detallada.' },

      categoria: {
        enum: [...CATEGORIAS],
        description: 'Categoría. Discrimina la rama oneOf del validador.',
      },
      prioridad: { enum: [...PRIORIDADES], description: 'Nivel de urgencia.' },
      estado:    { enum: [...ESTADOS],    description: 'Estado del ciclo de vida.' },

      reportante: {
        bsonType: 'object',
        required: ['nombre', 'correo', 'tipo'],
        additionalProperties: false,
        properties: {
          nombre: txt,
          correo: txt,
          tipo:   { enum: [...TIPOS_REPORTANTE] },
        },
      },

      ubicacion: {
        bsonType: 'object',
        required: ['edificio'],
        additionalProperties: false,
        properties: {
          edificio: txt,
          aula:     txt,   // opcional
        },
      },

      // Validado en profundidad por el oneOf de cada categoría
      detalle_especifico: {
        bsonType: 'object',
        description: 'Subdocumento polimórfico. Su estructura depende de "categoria".',
      },

      tags: {
        bsonType: 'array',
        items: txt,
        description: 'Etiquetas. Sin duplicados (enforced por $addToSet en actualizaciones).',
      },

      historial_seguimiento: {
        bsonType: 'array',
        minItems: 1,
        items: {
          bsonType: 'object',
          required: ['fecha', 'autor', 'estado', 'comentario'],
          additionalProperties: false,
          properties: {
            fecha:      fch,
            autor:      txt,
            estado:     { enum: [...ESTADOS] },
            comentario: txt,
          },
        },
        description: 'Bitácora de cambios de estado. Mínimo una entrada.',
      },

      evidencias: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['tipo', 'nombre_original', 'storage_path', 'tamano_bytes', 'fecha_carga'],
          additionalProperties: false,
          properties: {
            tipo:            txt,   // MIME type, ej. "image/jpeg"
            nombre_original: txt,
            storage_path:    txt,   // ruta en bucket Supabase; URLs firmadas al consultar
            tamano_bytes:    { bsonType: ['int', 'double'], minimum: 0 },
            fecha_carga:     fch,
          },
        },
        description: 'Metadatos de archivos en Supabase Storage. Arreglo vacío si no hay evidencias.',
      },

      horas_invertidas: {
        ...num,
        description: 'Horas acumuladas. Incrementar con $inc, nunca sobreescribir.',
      },

      fecha_creacion: {
        ...fch,
        description: 'Timestamp UTC de creación del documento.',
      },

      // CAMPO OPCIONAL — solo presente cuando estado ∈ ESTADOS_CERRADOS.
      // El TTL index (idx_ttl_fecha_cierre) apunta aquí.
      // Se añade con $set al cerrar y se elimina con $unset al reabrir.
      // NUNCA debe ser mayor a ~59 días de antigüedad (Atlas borra inmediatamente
      // documentos cuyo TTL ya venció). El seed usa un máximo de 45 días.
      fecha_cierre: {
        ...fch,
        description:
          'Fecha de resolución/cierre. OPCIONAL: solo en estado resuelta o cerrada. ' +
          'Campo del índice TTL (60 días). Se gestiona con $set / $unset atómico junto con "estado".',
      },

      // CAMPO OPCIONAL — supervisor que aceptó o revisó la petición.
      responsable_atencion: {
        bsonType: 'object',
        required: ['nombre', 'correo'],
        additionalProperties: false,
        properties: {
          nombre: txt,
          correo: txt,
        },
        description: 'Supervisor responsable. Solo perfiles administrador/superAdmin.',
      },

      // CAMPO OPCIONAL — técnico que tomó o recibió la tarea.
      tecnico_asignado: {
        bsonType: 'object',
        required: ['nombre', 'correo'],
        additionalProperties: false,
        properties: {
          nombre: txt,
          correo: txt,
        },
        description: 'Técnico asignado a la reparación.',
      },

      // CAMPO LEGACY — se conserva para compatibilidad con incidencias previas.
      asignado_a: {
        bsonType: 'object',
        additionalProperties: false,
        properties: {
          nombre: txt,
          correo: txt,
        },
        description: 'Asignación previa, conservada para compatibilidad.',
      },
    },

    // ── Polimorfismo por categoría ────────────────────────────────────────────
    oneOf: [
      ramaCategoria(
        'computo_redes',
        {
          tipo_equipo:       txt,
          ip:                txt,
          vlan:              { bsonType: ['int', 'double'], minimum: 1, maximum: 4094 },
          puerto_uplink:     txt,
          equipos_afectados: num,
        },
        ['tipo_equipo', 'ip', 'vlan', 'puerto_uplink', 'equipos_afectados'],
      ),

      ramaCategoria(
        'infraestructura_fisica',
        {
          tipo_dano:            txt,
          nivel_deterioro:      { enum: ['leve', 'moderado', 'severo'] },
          riesgo_seguridad:     { enum: ['bajo', 'medio', 'alto'] },
          requiere_contratista: bool,
        },
        ['tipo_dano', 'nivel_deterioro', 'riesgo_seguridad', 'requiere_contratista'],
      ),

      ramaCategoria(
        'servicios_academicos',
        {
          plataforma:             txt,
          codigo_curso:           txt,
          periodo_escolar:        txt,
          estudiantes_impactados: num,
        },
        ['plataforma', 'codigo_curso', 'periodo_escolar', 'estudiantes_impactados'],
      ),
    ],
  },
};

// ── Definición de índices obligatorios ────────────────────────────────────────

const INDICES_INCIDENCIAS = [
  {
    // Índice 1 — Compuesto: aprovechado por el pipeline analítico
    // y por consultas filtradas por categoría + estado + edificio.
    name: IDX_COMPUESTO,
    key: { categoria: 1, estado: 1, 'ubicacion.edificio': 1 },
    options: {},
  },
  {
    // Índice 2 — Texto completo en español.
    // Solo puede existir UN índice de texto por colección.
    // Incluye tags para búsquedas por etiqueta.
    name: IDX_TEXTO,
    key: { titulo: 'text', descripcion: 'text', tags: 'text' },
    options: {
      default_language: 'spanish',
      weights: { titulo: 10, descripcion: 5, tags: 3 },
    },
  },
  {
    // Índice 3 — TTL de 60 días sobre fecha_cierre.
    // sparse:true → ignora documentos que no tienen el campo
    // (los que están en estado abierta/en_proceso/en_espera).
    name: IDX_TTL,
    key: { fecha_cierre: 1 },
    options: { expireAfterSeconds: TTL_SEGUNDOS, sparse: true },
  },
  {
    // Índice 4 — Único sobre el folio (campo "codigo").
    // Garantiza integridad del consecutivo generado por el contador.
    name: IDX_UNICO_FOLIO,
    key: { codigo: 1 },
    options: { unique: true },
  },
];

const INDICES_USUARIOS = [
  {
    // Índice único sobre correo institucional
    name: IDX_UNICO_CORREO,
    key: { correo: 1 },
    options: { unique: true },
  },
];

/**
 * Sincroniza un índice de forma idempotente y profunda:
 * 1. Inspecciona índices existentes con listIndexes.
 * 2. Compara clave y opciones.
 * 3. Si no existe → crea (reporta 'creado').
 * 4. Si existe e idéntico → no hace nada (reporta 'igual').
 * 5. Si solo difiere en expireAfterSeconds → usa collMod (reporta 'modificado').
 * 6. Si difiere en clave u otras opciones → dropIndex + createIndex (reporta 'recreado').
 */
async function sincronizarIndice(db, colNombre, defIndice) {
  const col = db.collection(colNombre);
  const indices = await col.indexes();
  const existente = indices.find(i => i.name === defIndice.name);

  if (!existente) {
    // Si es índice de texto, verificar si existe uno colisionante auto-nombrado
    const esTexto = Object.values(defIndice.key).includes('text');
    if (esTexto) {
      const colision = indices.find(i => i.name !== '_id_' && Object.values(i.key ?? {}).includes('text'));
      if (colision) {
        warn(`Índice de texto colisionante "${colision.name}" detectado en ${colNombre} → drop.`);
        await col.dropIndex(colision.name);
      }
    }
    await col.createIndex(defIndice.key, { name: defIndice.name, ...defIndice.options });
    log(`[CREADO] Índice "${defIndice.name}" en "${colNombre}".`);
    return 'creado';
  }

  // Comparación de claves y opciones
  const mismaClave = JSON.stringify(existente.key) === JSON.stringify(defIndice.key);
  const mismoUnique = Boolean(existente.unique) === Boolean(defIndice.options?.unique);
  const mismoSparse = Boolean(existente.sparse) === Boolean(defIndice.options?.sparse);
  const ttlExistente = existente.expireAfterSeconds;
  const ttlDeseado = defIndice.options?.expireAfterSeconds;
  const mismoTTL = ttlExistente === ttlDeseado;

  if (mismaClave && mismoUnique && mismoSparse) {
    if (mismoTTL) {
      log(`[IGUAL] Índice "${defIndice.name}" en "${colNombre}" sin cambios (definición idéntica).`);
      return 'igual';
    }
    if (ttlDeseado !== undefined) {
      // Diferencia únicamente en expireAfterSeconds → usar collMod
      await db.command({
        collMod: colNombre,
        index: {
          keyPattern: defIndice.key,
          expireAfterSeconds: ttlDeseado,
        },
      });
      log(`[MODIFICADO] Índice TTL "${defIndice.name}" en "${colNombre}": expireAfterSeconds actualizado a ${ttlDeseado}s vía collMod.`);
      return 'modificado';
    }
  }

  // Difiere en clave o restricciones clave → recrear
  warn(`[RECREANDO] Índice "${defIndice.name}" en "${colNombre}" difiere en opciones → drop + createIndex.`);
  await col.dropIndex(defIndice.name);
  await col.createIndex(defIndice.key, { name: defIndice.name, ...defIndice.options });
  log(`[RECREADO] Índice "${defIndice.name}" en "${colNombre}" recreado exitosamente.`);
  return 'recreado';
}

// ── Generador de datos sintéticos ─────────────────────────────────────────────

/** Fecha relativa a ahora, N días atrás, hora aleatoria entre 8:00 y 16:00 */
function fechaAtras(dias) {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  d.setHours(8 + Math.floor(Math.random() * 8), Math.floor(Math.random() * 60), 0, 0);
  return d;
}

/** Folio en formato INC-AAAA-NNNN */
function folio(n) {
  return `INC-${FOLIO_ANIO}-${String(n).padStart(4, '0')}`;
}

/** Entrada inicial del historial al crear la incidencia */
function entradaInicial(fecha, autor) {
  return { fecha, autor, estado: 'abierta', comentario: 'Incidencia registrada en el sistema.' };
}

/**
 * fecha_cierre para documentos cerrados.
 * Máximo 45 días de antigüedad (margen de seguridad vs. TTL de 60 días).
 */
function fechaCierre(dias) {
  return fechaAtras(Math.min(dias, 45));
}

/**
 * Valida que TODOS los documentos sintéticos cumplan la regla de fecha_cierre:
 *  - resuelta/cerrada → debe tener fecha_cierre y no mayor a 50 días.
 *  - cualquier otro estado → NO debe tener fecha_cierre.
 * Lanza Error si algo falla (bloquea el script antes de tocar Atlas).
 */
function validarFechasDocumentos(docs) {
  const ahora = new Date();
  const limite = new Date(ahora.getTime() - 50 * 24 * 60 * 60 * 1000);
  const errores = [];

  for (const doc of docs) {
    const esCerrado = ESTADOS_CERRADOS.includes(doc.estado);
    if (esCerrado && !doc.fecha_cierre) {
      errores.push(`${doc.codigo} (${doc.estado}): falta fecha_cierre.`);
    }
    if (!esCerrado && doc.fecha_cierre) {
      errores.push(`${doc.codigo} (${doc.estado}): tiene fecha_cierre pero no está cerrado.`);
    }
    if (doc.fecha_cierre && doc.fecha_cierre < limite) {
      const dias = Math.floor((ahora - doc.fecha_cierre) / 86_400_000);
      errores.push(`${doc.codigo}: fecha_cierre tiene ${dias} días (máx 50, o Atlas lo borrará).`);
    }
  }

  if (errores.length > 0) {
    throw new Error(
      `Validación de datos sintéticos fallida (${errores.length} error(es)):\n` +
      errores.map(e => `  • ${e}`).join('\n'),
    );
  }
}

function generarDocumentos() {
  // ── Cómputo y Redes (8 docs) ────────────────────────────────────────────────
  const computo = [
    {
      codigo: folio(1),
      titulo: 'Switch sin señal en Edificio A',
      descripcion: 'El switch del rack principal del Edificio A dejó de responder tras corte de luz.',
      categoria: 'computo_redes', prioridad: 'critica', estado: 'cerrada',
      reportante: { nombre: 'Carlos Méndez', correo: 'carlos.mendez@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Rack-01' },
      detalle_especifico: { tipo_equipo: 'switch', ip: '192.168.1.1', vlan: 10, puerto_uplink: 'Gi0/1', equipos_afectados: 45 },
      tags: ['red', 'switch', 'corte-luz', 'edificio-a'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(20), 'Carlos Méndez'),
        { fecha: fechaAtras(19), autor: 'Luis Mena',   estado: 'en_proceso', comentario: 'Técnico revisando switch.' },
        { fecha: fechaAtras(18), autor: 'Luis Mena',   estado: 'resuelta',   comentario: 'Switch reiniciado y funcional.' },
        { fecha: fechaAtras(17), autor: 'Héctor Poot', estado: 'cerrada',    comentario: 'Verificación completada. Caso cerrado.' },
      ],
      evidencias: [], horas_invertidas: 6,
      fecha_creacion: fechaAtras(20), fecha_cierre: fechaCierre(17),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(2),
      titulo: 'Sin acceso a internet en laboratorio de cómputo L3',
      descripcion: 'Los 30 equipos del laboratorio L3 no tienen salida a internet desde esta mañana.',
      categoria: 'computo_redes', prioridad: 'alta', estado: 'en_proceso',
      reportante: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio B', aula: 'L3' },
      detalle_especifico: { tipo_equipo: 'router', ip: '10.0.3.1', vlan: 30, puerto_uplink: 'Gi1/0', equipos_afectados: 30 },
      tags: ['internet', 'laboratorio', 'edificio-b'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(3), 'Karla Pech'),
        { fecha: fechaAtras(2), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Revisando configuración del router.' },
      ],
      evidencias: [], horas_invertidas: 3,
      fecha_creacion: fechaAtras(3),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(3),
      titulo: 'IP duplicada en VLAN 20 — Administración',
      descripcion: 'Conflicto de IP en red administrativa. Dos equipos comparten 192.168.20.50.',
      categoria: 'computo_redes', prioridad: 'alta', estado: 'resuelta',
      reportante: { nombre: 'María Torres', correo: 'm.torres@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio C', aula: 'Oficina 204' },
      detalle_especifico: { tipo_equipo: 'workstation', ip: '192.168.20.50', vlan: 20, puerto_uplink: 'Gi0/24', equipos_afectados: 2 },
      tags: ['ip-duplicada', 'vlan', 'administracion'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(10), 'María Torres'),
        { fecha: fechaAtras(9), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Identificados los equipos en conflicto.' },
        { fecha: fechaAtras(8), autor: 'Luis Mena', estado: 'resuelta',   comentario: 'IP reasignada. Conflicto resuelto.' },
      ],
      evidencias: [], horas_invertidas: 4,
      fecha_creacion: fechaAtras(10), fecha_cierre: fechaCierre(8),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(4),
      titulo: 'Impresora de red sin respuesta — Biblioteca',
      descripcion: 'La impresora HP LaserJet de la biblioteca no responde por red. Posible falla de tarjeta.',
      categoria: 'computo_redes', prioridad: 'media', estado: 'abierta',
      reportante: { nombre: 'Ana López', correo: 'ana.lopez@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Biblioteca', aula: 'Área de impresión' },
      detalle_especifico: { tipo_equipo: 'impresora', ip: '192.168.5.20', vlan: 5, puerto_uplink: 'Fa0/12', equipos_afectados: 1 },
      tags: ['impresora', 'biblioteca', 'red'],
      historial_seguimiento: [ entradaInicial(fechaAtras(1), 'Ana López') ],
      evidencias: [], horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(5),
      titulo: 'Access point caído — Sala de Maestros Edif. B',
      descripcion: 'El access point Cisco del segundo piso del Edificio B no emite señal WiFi.',
      categoria: 'computo_redes', prioridad: 'media', estado: 'en_espera',
      reportante: { nombre: 'Prof. Roberto Dzul', correo: 'r.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'Sala de Maestros' },
      detalle_especifico: { tipo_equipo: 'access_point', ip: '10.0.2.45', vlan: 2, puerto_uplink: 'Gi0/5', equipos_afectados: 15 },
      tags: ['wifi', 'access-point', 'edificio-b'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(5), 'Prof. Roberto Dzul'),
        { fecha: fechaAtras(4), autor: 'Luis Mena', estado: 'en_espera', comentario: 'En espera de refacción (AP de reemplazo).' },
      ],
      evidencias: [], horas_invertidas: 1,
      fecha_creacion: fechaAtras(5),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(6),
      titulo: 'Servidor NAS lento — Edif. A',
      descripcion: 'El servidor NAS del Edificio A presenta latencias de 2000ms. Se sospecha disco en falla.',
      categoria: 'computo_redes', prioridad: 'alta', estado: 'en_proceso',
      reportante: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio A', aula: 'Cuarto de servidores' },
      detalle_especifico: { tipo_equipo: 'servidor_nas', ip: '192.168.1.10', vlan: 10, puerto_uplink: 'Gi0/2', equipos_afectados: 60 },
      tags: ['servidor', 'nas', 'latencia', 'disco'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(7), 'Héctor Poot'),
        { fecha: fechaAtras(6), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'SMART test: sectores defectuosos. Iniciando reemplazo.' },
      ],
      evidencias: [], horas_invertidas: 8,
      fecha_creacion: fechaAtras(7),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(7),
      titulo: 'Firewall bloqueando Moodle — VLAN 40',
      descripcion: 'Regla del firewall bloquea puerto 443 hacia Moodle para equipos de la VLAN 40.',
      categoria: 'computo_redes', prioridad: 'critica', estado: 'resuelta',
      reportante: { nombre: 'Dra. Lucía Can', correo: 'l.can@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 101' },
      detalle_especifico: { tipo_equipo: 'firewall', ip: '10.0.0.1', vlan: 40, puerto_uplink: 'Gi1/1', equipos_afectados: 80 },
      tags: ['firewall', 'moodle', 'bloqueo', 'vlan-40'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(15), 'Dra. Lucía Can'),
        { fecha: fechaAtras(14), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Identificada la regla errónea.' },
        { fecha: fechaAtras(13), autor: 'Luis Mena', estado: 'resuelta',   comentario: 'Regla eliminada. Acceso a Moodle restaurado.' },
      ],
      evidencias: [], horas_invertidas: 5,
      fecha_creacion: fechaAtras(15), fecha_cierre: fechaCierre(13),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(8),
      titulo: 'Cableado dañado — Laboratorio L1',
      descripcion: 'Cables de red visiblemente dañados en pasacables del laboratorio L1. Pérdida de paquetes 60%.',
      categoria: 'computo_redes', prioridad: 'alta', estado: 'abierta',
      reportante: { nombre: 'Prof. Iván Uicab', correo: 'i.uicab@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'L1' },
      detalle_especifico: { tipo_equipo: 'cableado', ip: 'N/A', vlan: 30, puerto_uplink: 'Fa0/8', equipos_afectados: 25 },
      tags: ['cableado', 'laboratorio', 'perdida-paquetes'],
      historial_seguimiento: [ entradaInicial(fechaAtras(2), 'Prof. Iván Uicab') ],
      evidencias: [], horas_invertidas: 0,
      fecha_creacion: fechaAtras(2),
    },
  ];

  // ── Infraestructura Física (9 docs) ─────────────────────────────────────────
  const infra = [
    {
      codigo: folio(9),
      titulo: 'Fuga de agua en techo — Edif. C, Aula 305',
      descripcion: 'Infiltración de agua en techo del aula 305 tras lluvias. Riesgo de cortocircuito.',
      categoria: 'infraestructura_fisica', prioridad: 'critica', estado: 'en_proceso',
      reportante: { nombre: 'Prof. Sandra Xool', correo: 's.xool@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio C', aula: 'Aula 305' },
      detalle_especifico: { tipo_dano: 'infiltracion_agua', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['fuga', 'agua', 'techo', 'edificio-c', 'electrico'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(4), 'Prof. Sandra Xool'),
        { fecha: fechaAtras(3), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Cotización con proveedor en trámite.' },
      ],
      evidencias: [], horas_invertidas: 2,
      fecha_creacion: fechaAtras(4),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(10),
      titulo: 'Puerta de emergencia bloqueada — Edif. A',
      descripcion: 'La palanca de la salida de emergencia del primer piso del Edificio A no acciona.',
      categoria: 'infraestructura_fisica', prioridad: 'critica', estado: 'resuelta',
      reportante: { nombre: 'Vigilante turno matutino', correo: 'vigilancia@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio A', aula: 'Salida norte' },
      detalle_especifico: { tipo_dano: 'puerta_emergencia', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: false },
      tags: ['emergencia', 'puerta', 'seguridad', 'edificio-a'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(30), 'Vigilante turno matutino'),
        { fecha: fechaAtras(29), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Técnico de mantenimiento revisando.' },
        { fecha: fechaAtras(28), autor: 'Héctor Poot', estado: 'resuelta',   comentario: 'Mecanismo reparado. Puerta operativa.' },
      ],
      evidencias: [], horas_invertidas: 3,
      fecha_creacion: fechaAtras(30), fecha_cierre: fechaCierre(28),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(11),
      titulo: 'Luminaria fundida — Pasillo principal Edif. B',
      descripcion: 'Tres luminarias del pasillo principal del Edificio B están fundidas, creando zona oscura.',
      categoria: 'infraestructura_fisica', prioridad: 'media', estado: 'cerrada',
      reportante: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio B', aula: 'Pasillo principal' },
      detalle_especifico: { tipo_dano: 'luminaria', nivel_deterioro: 'leve', riesgo_seguridad: 'medio', requiere_contratista: false },
      tags: ['luminaria', 'electricidad', 'edificio-b'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(40), 'Karla Pech'),
        { fecha: fechaAtras(39), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Focos de reemplazo adquiridos.' },
        { fecha: fechaAtras(38), autor: 'Héctor Poot', estado: 'resuelta',   comentario: 'Luminarias reemplazadas.' },
        { fecha: fechaAtras(37), autor: 'Héctor Poot', estado: 'cerrada',    comentario: 'Caso cerrado tras verificación.' },
      ],
      evidencias: [], horas_invertidas: 2,
      fecha_creacion: fechaAtras(40), fecha_cierre: fechaCierre(37),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(12),
      titulo: 'Vidrio roto — ventana Aula 112 Edif. D',
      descripcion: 'Ventana del aula 112 tiene el vidrio fragmentado. Riesgo de corte.',
      categoria: 'infraestructura_fisica', prioridad: 'alta', estado: 'abierta',
      reportante: { nombre: 'Prof. Elena Canul', correo: 'e.canul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 112' },
      detalle_especifico: { tipo_dano: 'vidrio_roto', nivel_deterioro: 'moderado', riesgo_seguridad: 'medio', requiere_contratista: false },
      tags: ['vidrio', 'ventana', 'riesgo'],
      historial_seguimiento: [ entradaInicial(fechaAtras(1), 'Prof. Elena Canul') ],
      evidencias: [], horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(13),
      titulo: 'Baño fuera de servicio — Edif. C, planta baja',
      descripcion: 'Sanitario masculino de planta baja con tubería rota y acumulación de agua.',
      categoria: 'infraestructura_fisica', prioridad: 'alta', estado: 'en_proceso',
      reportante: { nombre: 'Ana López', correo: 'ana.lopez@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio C', aula: 'Baño planta baja' },
      detalle_especifico: { tipo_dano: 'tuberia_rota', nivel_deterioro: 'severo', riesgo_seguridad: 'medio', requiere_contratista: true },
      tags: ['plomeria', 'bano', 'edificio-c'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(6), 'Ana López'),
        { fecha: fechaAtras(5), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Plomero externo contratado. Trabajo en progreso.' },
      ],
      evidencias: [], horas_invertidas: 4,
      fecha_creacion: fechaAtras(6),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(14),
      titulo: 'Aire acondicionado ruidoso — Sala de Cómputo Edif. A',
      descripcion: 'El A/C del Edificio A hace ruido excesivo y vibración. No enfría correctamente.',
      categoria: 'infraestructura_fisica', prioridad: 'baja', estado: 'en_espera',
      reportante: { nombre: 'Prof. Iván Uicab', correo: 'i.uicab@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Sala de Cómputo' },
      detalle_especifico: { tipo_dano: 'aire_acondicionado', nivel_deterioro: 'leve', riesgo_seguridad: 'bajo', requiere_contratista: true },
      tags: ['aire-acondicionado', 'ruido', 'edificio-a'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(12), 'Prof. Iván Uicab'),
        { fecha: fechaAtras(11), autor: 'Héctor Poot', estado: 'en_espera', comentario: 'En espera de autorización presupuestal.' },
      ],
      evidencias: [], horas_invertidas: 1,
      fecha_creacion: fechaAtras(12),
    },
    {
      codigo: folio(15),
      titulo: 'Rampa para silla de ruedas dañada — Entrada principal',
      descripcion: 'La rampa de acceso principal tiene grietas profundas y pernos expuestos.',
      categoria: 'infraestructura_fisica', prioridad: 'alta', estado: 'abierta',
      reportante: { nombre: 'María Torres', correo: 'm.torres@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Entrada norte' },
      detalle_especifico: { tipo_dano: 'rampa_daniada', nivel_deterioro: 'moderado', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['accesibilidad', 'rampa', 'seguridad', 'entrada'],
      historial_seguimiento: [ entradaInicial(fechaAtras(3), 'María Torres') ],
      evidencias: [], horas_invertidas: 0,
      fecha_creacion: fechaAtras(3),
    },
    {
      codigo: folio(16),
      titulo: 'Extinguidor vencido — Edif. D, 2do piso',
      descripcion: 'El extintor del segundo piso del Edificio D tiene fecha de recarga vencida 3 meses.',
      categoria: 'infraestructura_fisica', prioridad: 'critica', estado: 'resuelta',
      reportante: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio D', aula: 'Pasillo 2do piso' },
      detalle_especifico: { tipo_dano: 'extintor_vencido', nivel_deterioro: 'moderado', riesgo_seguridad: 'alto', requiere_contratista: false },
      tags: ['extintor', 'seguridad', 'contra-incendios'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(25), 'Héctor Poot'),
        { fecha: fechaAtras(24), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Solicitada recarga con empresa certificada.' },
        { fecha: fechaAtras(22), autor: 'Héctor Poot', estado: 'resuelta',   comentario: 'Extintor recargado y certificado.' },
      ],
      evidencias: [], horas_invertidas: 3,
      fecha_creacion: fechaAtras(25), fecha_cierre: fechaCierre(22),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(17),
      titulo: 'Escalera sin barandal — Edif. B, escalera norte',
      descripcion: 'El barandal de la escalera norte del Edificio B está desprendido. Riesgo de caída.',
      categoria: 'infraestructura_fisica', prioridad: 'alta', estado: 'en_proceso',
      reportante: { nombre: 'Prof. Roberto Dzul', correo: 'r.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'Escalera norte' },
      detalle_especifico: { tipo_dano: 'barandal_desprendido', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['barandal', 'escalera', 'caida', 'edificio-b'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(8), 'Prof. Roberto Dzul'),
        { fecha: fechaAtras(7), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Zona acordonada. Empresa contratada para soldadura.' },
      ],
      evidencias: [], horas_invertidas: 2,
      fecha_creacion: fechaAtras(8),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
  ];

  // ── Servicios Académicos (8 docs) ────────────────────────────────────────────
  const academico = [
    {
      codigo: folio(18),
      titulo: 'Moodle sin acceso — grupo 3-A Ing. Software',
      descripcion: 'Los alumnos del grupo 3-A no pueden acceder a la asignatura de Bases de Datos en Moodle.',
      categoria: 'servicios_academicos', prioridad: 'alta', estado: 'resuelta',
      reportante: { nombre: 'Dra. Lucía Can', correo: 'l.can@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 205' },
      detalle_especifico: { plataforma: 'Moodle', codigo_curso: 'BD-2026-3A', periodo_escolar: '2026-1', estudiantes_impactados: 28 },
      tags: ['moodle', 'acceso', 'bases-de-datos', '3A'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(18), 'Dra. Lucía Can'),
        { fecha: fechaAtras(17), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Revisando permisos del curso.' },
        { fecha: fechaAtras(16), autor: 'Karla Pech', estado: 'resuelta',   comentario: 'Permisos corregidos. Alumnos con acceso.' },
      ],
      evidencias: [], horas_invertidas: 3,
      fecha_creacion: fechaAtras(18), fecha_cierre: fechaCierre(16),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(19),
      titulo: 'Plataforma Teams caída durante examen parcial',
      descripcion: 'Teams dejó de funcionar durante el examen del grupo 2-B de Sistemas.',
      categoria: 'servicios_academicos', prioridad: 'critica', estado: 'cerrada',
      reportante: { nombre: 'Prof. Alberto Cob', correo: 'a.cob@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Aula 108' },
      detalle_especifico: { plataforma: 'Microsoft Teams', codigo_curso: 'SIS-2026-2B', periodo_escolar: '2026-1', estudiantes_impactados: 35 },
      tags: ['teams', 'examen', 'caida', 'parcial'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(35), 'Prof. Alberto Cob'),
        { fecha: fechaAtras(34), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Reportado a Microsoft. Examen reprogramado.' },
        { fecha: fechaAtras(33), autor: 'Karla Pech', estado: 'resuelta',   comentario: 'Servicio restaurado. Examen realizado.' },
        { fecha: fechaAtras(32), autor: 'Héctor Poot', estado: 'cerrada',   comentario: 'Caso documentado. Cerrado.' },
      ],
      evidencias: [], horas_invertidas: 6,
      fecha_creacion: fechaAtras(35), fecha_cierre: fechaCierre(32),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(20),
      titulo: 'Cuenta institucional bloqueada — alumno nuevo ingreso',
      descripcion: 'Alumno de nuevo ingreso no puede activar su cuenta @utmetropolitana.edu.mx.',
      categoria: 'servicios_academicos', prioridad: 'media', estado: 'en_proceso',
      reportante: { nombre: 'Diego Tuz', correo: 'diego.tuz@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Servicio Escolar' },
      detalle_especifico: { plataforma: 'Google Workspace', codigo_curso: 'INGRESO-2026', periodo_escolar: '2026-1', estudiantes_impactados: 1 },
      tags: ['cuenta', 'correo', 'nuevo-ingreso', 'google-workspace'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(2), 'Diego Tuz'),
        { fecha: fechaAtras(1), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Verificando matrícula en sistema escolar.' },
      ],
      evidencias: [], horas_invertidas: 1,
      fecha_creacion: fechaAtras(2),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(21),
      titulo: 'Calificaciones no reflejadas — 4-A ITA',
      descripcion: 'Las calificaciones del parcial II del grupo 4-A de ITA no aparecen en el sistema escolar.',
      categoria: 'servicios_academicos', prioridad: 'alta', estado: 'abierta',
      reportante: { nombre: 'Prof. Mariana Dzul', correo: 'm.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 310' },
      detalle_especifico: { plataforma: 'SIIA', codigo_curso: 'ITA-2026-4A', periodo_escolar: '2026-1', estudiantes_impactados: 32 },
      tags: ['calificaciones', 'siia', 'control-escolar', '4A'],
      historial_seguimiento: [ entradaInicial(fechaAtras(1), 'Prof. Mariana Dzul') ],
      evidencias: [], horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(22),
      titulo: 'Videoconferencia sin audio — Sala de videoconferencias',
      descripcion: 'El sistema de videoconferencia no transmite audio en reuniones remotas.',
      categoria: 'servicios_academicos', prioridad: 'alta', estado: 'en_espera',
      reportante: { nombre: 'Director académico', correo: 'direccion@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Sala de videoconferencias' },
      detalle_especifico: { plataforma: 'Zoom Rooms', codigo_curso: 'ADM-2026', periodo_escolar: '2026-1', estudiantes_impactados: 0 },
      tags: ['videoconferencia', 'audio', 'zoom', 'sala'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(9), 'Director académico'),
        { fecha: fechaAtras(8), autor: 'Karla Pech', estado: 'en_espera', comentario: 'En espera de técnico especialista en AV.' },
      ],
      evidencias: [], horas_invertidas: 2,
      fecha_creacion: fechaAtras(9),
    },
    {
      codigo: folio(23),
      titulo: 'Biblioteca digital sin acceso — EBSCO y Redalyc',
      descripcion: 'Los accesos a EBSCO y Redalyc están caídos para todos los usuarios.',
      categoria: 'servicios_academicos', prioridad: 'media', estado: 'resuelta',
      reportante: { nombre: 'Bibliotecaria', correo: 'biblioteca@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Biblioteca', aula: 'Sala digital' },
      detalle_especifico: { plataforma: 'EBSCO / Redalyc', codigo_curso: 'BIBLIOTECA-2026', periodo_escolar: '2026-1', estudiantes_impactados: 500 },
      tags: ['biblioteca-digital', 'ebsco', 'redalyc', 'investigacion'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(14), 'Bibliotecaria'),
        { fecha: fechaAtras(13), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Contactando al proveedor de licencias.' },
        { fecha: fechaAtras(12), autor: 'Karla Pech', estado: 'resuelta',   comentario: 'Licencias renovadas. Acceso restaurado.' },
      ],
      evidencias: [], horas_invertidas: 4,
      fecha_creacion: fechaAtras(14), fecha_cierre: fechaCierre(12),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(24),
      titulo: 'Error al subir tarea en Moodle — grupo 1-A Admon',
      descripcion: 'Alumnos del grupo 1-A no pueden subir archivos mayores a 5MB en tarea de Estadística.',
      categoria: 'servicios_academicos', prioridad: 'baja', estado: 'resuelta',
      reportante: { nombre: 'Sofía Cupul', correo: 's.cupul@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio C', aula: 'Aula 201' },
      detalle_especifico: { plataforma: 'Moodle', codigo_curso: 'ADMON-2026-1A', periodo_escolar: '2026-1', estudiantes_impactados: 30 },
      tags: ['moodle', 'subida-archivos', 'limite-tamano'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(22), 'Sofía Cupul'),
        { fecha: fechaAtras(21), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Aumentando límite de subida en la configuración del curso.' },
        { fecha: fechaAtras(20), autor: 'Karla Pech', estado: 'resuelta',   comentario: 'Límite aumentado a 50MB. Alumnos pueden subir.' },
      ],
      evidencias: [], horas_invertidas: 2,
      fecha_creacion: fechaAtras(22), fecha_cierre: fechaCierre(20),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(25),
      titulo: 'Generador de horarios fuera de línea — inicio de semestre',
      descripcion: 'El SIIA para generación de horarios 2026-2 no carga para ningún docente.',
      categoria: 'servicios_academicos', prioridad: 'critica', estado: 'en_proceso',
      reportante: { nombre: 'Coordinadora académica', correo: 'coordinacion@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Coordinación académica' },
      detalle_especifico: { plataforma: 'SIIA', codigo_curso: 'HORARIOS-2026-2', periodo_escolar: '2026-2', estudiantes_impactados: 800 },
      tags: ['siia', 'horarios', 'inicio-semestre', 'critico'],
      historial_seguimiento: [
        entradaInicial(fechaAtras(5), 'Coordinadora académica'),
        { fecha: fechaAtras(4), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Escalado al proveedor del SIIA. Esperando parche.' },
      ],
      evidencias: [], horas_invertidas: 5,
      fecha_creacion: fechaAtras(5),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
  ];

  return [...computo, ...infra, ...academico]; // 25 documentos
}

// ── FUNCIÓN PRINCIPAL ──────────────────────────────────────────────────────────

async function main() {
  let client;
  const BCRYPT_ROUNDS = 12;

  // Generar y validar documentos sintéticos ANTES de conectar
  // Si hay un error de fechas, el script falla en seco sin tocar Atlas.
  const documentos = generarDocumentos();
  validarFechasDocumentos(documentos);

  try {
    // ── 1. Conexión ────────────────────────────────────────────────────────────
    section('1. Conexión a MongoDB Atlas');
    info(`Archivo .env: ${ENV_PATH}`);
    info(`  Estado carga: ${envError ? `ERROR — ${envError.message}` : 'OK'}`);
    info(`Base destino: "${DB_NAME}" (MONGODB_DB_NAME en .env; default de constants.js: "${DEFAULT_DB_NAME}")`);
    info(`Host Atlas: ${safeHost(MONGODB_URI)}`);

    if (!DRY_RUN) {
      client = new MongoClient(MONGODB_URI, {
        // strict: false porque strict: true bloquea los índices y consultas de texto ($text), que son un requisito del proyecto
        serverApi: { version: ServerApiVersion.v1, strict: false, deprecationErrors: true },
      });
      await client.connect();
      log(`Conectado — host: ${safeHost(MONGODB_URI)} — base: ${DB_NAME}`);
    }

    const db = DRY_RUN ? null : client.db(DB_NAME);

    // ── 2. Colección incidencias_campus ────────────────────────────────────────
    section(`2. Colección "${COL_INCIDENCIAS}"`);
    if (DRY_RUN) {
      dry(`listCollections({ name: "${COL_INCIDENCIAS}" })`);
      dry(`  → si NO existe: createCollection con $jsonSchema (validationLevel: strict, validationAction: error)`);
      dry(`  → si YA existe (caso actual): collMod para aplicar/actualizar el validador`);
    } else {
      const existe = (await db.listCollections({ name: COL_INCIDENCIAS }).toArray()).length > 0;
      if (!existe) {
        await db.createCollection(COL_INCIDENCIAS, {
          validator: VALIDATOR,
          validationLevel: 'strict',
          validationAction: 'error',
        });
        log(`"${COL_INCIDENCIAS}" creada con validador.`);
      } else {
        await db.command({
          collMod: COL_INCIDENCIAS,
          validator: VALIDATOR,
          validationLevel: 'strict',
          validationAction: 'error',
        });
        log(`"${COL_INCIDENCIAS}" ya existía → validador actualizado con collMod.`);
      }
    }

    // ── 3. Colecciones auxiliares ──────────────────────────────────────────────
    section('3. Colecciones auxiliares');
    for (const nombre of [COL_CONTADORES, COL_USUARIOS]) {
      if (DRY_RUN) {
        dry(`listCollections({ name: "${nombre}" }) → createCollection si no existe`);
      } else {
        const existe = (await db.listCollections({ name: nombre }).toArray()).length > 0;
        if (!existe) {
          await db.createCollection(nombre);
          log(`"${nombre}" creada.`);
        } else {
          log(`"${nombre}" ya existe — sin cambios.`);
        }
      }
    }

    // ── 4. Índices ─────────────────────────────────────────────────────────────
    section(`4. Índices ("${COL_INCIDENCIAS}" y "${COL_USUARIOS}")`);
    if (DRY_RUN) {
      dry(`Índices obligatorios para "${COL_INCIDENCIAS}":`);
      for (const idx of INDICES_INCIDENCIAS) {
        dry(`  • ${idx.name} → key: ${JSON.stringify(idx.key)} options: ${JSON.stringify(idx.options)}`);
      }
      dry(`Índices obligatorios para "${COL_USUARIOS}":`);
      for (const idx of INDICES_USUARIOS) {
        dry(`  • ${idx.name} → key: ${JSON.stringify(idx.key)} options: ${JSON.stringify(idx.options)}`);
      }
      dry('Lógica de idempotencia: listIndexes para comparar key y opciones.');
      dry('  - Si son iguales → no toca (reporta igual).');
      dry('  - Si solo difiere expireAfterSeconds → collMod (reporta modificado).');
      dry('  - Si difieren otras opciones o key → dropIndex + createIndex (reporta recreado).');
    } else {
      for (const idx of INDICES_INCIDENCIAS) {
        await sincronizarIndice(db, COL_INCIDENCIAS, idx);
      }
      for (const idx of INDICES_USUARIOS) {
        await sincronizarIndice(db, COL_USUARIOS, idx);
      }
    }

    // ── 5. Documentos sintéticos ───────────────────────────────────────────────
    section(`5. Documentos sintéticos — ${documentos.length} docs (${COL_INCIDENCIAS})`);
    const foliosSinteticos = documentos.map(d => d.codigo);

    if (DRY_RUN) {
      if (RESEED) {
        dry(`[FLAG --reseed ACTIVO]:`);
        dry(`  deleteMany({ codigo: { $in: ["${foliosSinteticos[0]}" ... "${foliosSinteticos[foliosSinteticos.length - 1]}"] } })`);
        dry(`  → Se eliminarán ÚNICAMENTE los 25 folios sintéticos para reinserción fresca.`);
      } else {
        dry(`Modo seguro por defecto (sin --reseed):`);
        dry(`  updateOne({ codigo }, { $setOnInsert: <doc completo> }, { upsert: true })`);
        dry(`  → Si el código YA existe: no modifica nada (protege ediciones manuales y fechas).`);
      }
      dry(`Categorías: computo_redes ×${documentos.filter(d => d.categoria === 'computo_redes').length}, ` +
          `infraestructura_fisica ×${documentos.filter(d => d.categoria === 'infraestructura_fisica').length}, ` +
          `servicios_academicos ×${documentos.filter(d => d.categoria === 'servicios_academicos').length}`);
      dry(`Estados: ${ESTADOS.map(e => `${e} ×${documentos.filter(d => d.estado === e).length}`).join(', ')}`);
      dry(`Docs con fecha_cierre (TTL activo): ${documentos.filter(d => d.fecha_cierre).length}`);
      dry(`Docs SIN fecha_cierre (estado abierto): ${documentos.filter(d => !d.fecha_cierre).length}`);
      dry(`Fecha base de ejecución: ${new Date().toISOString()}`);
      dry(`Validación de fechas: OK — todas las fecha_cierre ≤ 45 días. Ningún estado abierto tiene fecha_cierre.`);
    } else {
      const col = db.collection(COL_INCIDENCIAS);

      if (RESEED) {
        const delRes = await col.deleteMany({ codigo: { $in: foliosSinteticos } });
        log(`--reseed: Eliminados ${delRes.deletedCount} documentos sintéticos previos (${foliosSinteticos[0]} a ${foliosSinteticos[foliosSinteticos.length - 1]}).`);
      }

      let insertados = 0, omitidos = 0;
      for (const doc of documentos) {
        const { codigo, ...resto } = doc;
        const r = await col.updateOne(
          { codigo },
          { $setOnInsert: { codigo, ...resto } },
          { upsert: true },
        );
        r.upsertedCount > 0 ? insertados++ : omitidos++;
      }
      log(`Insertados: ${insertados} | Ya existían (sin cambios): ${omitidos}`);
    }

    // ── 6. Contador de folios ──────────────────────────────────────────────────
    section('6. Contador de folios');
    const ultimoFolio = documentos.length; // 25
    if (DRY_RUN) {
      dry(`findOneAndUpdate({ _id: "${CONTADOR_ID}" }, { $max: { ultimo: ${ultimoFolio} } }, { upsert: true, returnDocument: "after" })`);
      dry(`  $max garantiza que el contador nunca baja (seguro si el backend ya creó folios nuevos).`);
      dry(`  Resultado esperado: { _id: "${CONTADOR_ID}", ultimo: max(valorActual, ${ultimoFolio}) }`);
    } else {
      const r = await db.collection(COL_CONTADORES).findOneAndUpdate(
        { _id: CONTADOR_ID },
        { $max: { ultimo: ultimoFolio } },
        { upsert: true, returnDocument: 'after' },
      );
      log(`Contador "${CONTADOR_ID}" → ultimo: ${r.ultimo}`);
    }

    // ── 7. superAdmin lizandro.reyes ───────────────────────────────────────────
    section('7. superAdmin lizandro.reyes');
    if (DRY_RUN) {
      if (RESET_ADMIN_PW) {
        dry(`--reset-admin-password activo:`);
        dry(`  bcryptjs.hash(SUPER_ADMIN_PASSWORD, ${BCRYPT_ROUNDS}) → nuevo hash`);
        dry(`  updateOne({ correo: "${SUPER_EMAIL}" }, { $set: { password_hash: <hash> } })`);
        dry(`  (Solo actualiza el hash; no toca nombre, rol ni otros campos.)`);
      } else {
        dry(`Modo normal (primera inserción):`);
        dry(`  bcryptjs.hash(SUPER_ADMIN_PASSWORD, ${BCRYPT_ROUNDS}) → hash`);
        dry(`  updateOne({ correo: "${SUPER_EMAIL}" }, { $setOnInsert: { nombre, correo, rol, activo, password_hash } }, { upsert: true })`);
        dry(`  → Si YA existe: no modifica nada (para cambiar contraseña usa --reset-admin-password).`);
      }
      dry(`  Correo destino: ${SUPER_EMAIL}`);
      dry(`  NOTA: el hash NUNCA se imprime en logs.`);
    } else {
      const hash = await bcrypt.hash(SUPER_PASSWORD, BCRYPT_ROUNDS);
      if (RESET_ADMIN_PW) {
        const r = await db.collection(COL_USUARIOS).updateOne(
          { correo: SUPER_EMAIL },
          { $set: { password_hash: hash } },
        );
        if (r.matchedCount === 0) {
          warn(`superAdmin "${SUPER_EMAIL}" no encontrado. Ejecuta sin --reset-admin-password para crearlo.`);
        } else {
          log(`superAdmin "${SUPER_EMAIL}" → hash actualizado (${BCRYPT_ROUNDS} rondas).`);
        }
      } else {
        await db.collection(COL_USUARIOS).updateOne(
          { correo: SUPER_EMAIL },
          {
            $setOnInsert: {
              nombre: 'lizandro.reyes',
              correo: SUPER_EMAIL,
              rol: 'superAdmin',
              activo: true,
              password_hash: hash,
            },
          },
          { upsert: true },
        );
        log(`superAdmin "${SUPER_EMAIL}" — creado (primera vez) o sin cambios si ya existía.`);
      }
    }

    // ── 8. Usuarios de prueba (seed) ───────────────────────────────────────────
    section('8. Usuarios de prueba (seed)');
    const seedUsers = [
      { nombre: 'Karla Pech',  correo: 'karla.pech@utmdesk.test',  rol: 'reportante'   },
      { nombre: 'Luis Mena',   correo: 'luis.mena@utmdesk.test',   rol: 'tecnico'       },
      { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', rol: 'administrador' },
    ];
    if (DRY_RUN) {
      dry(`Operación: updateOne({ correo }, { $setOnInsert: { ...usuario, password_hash } }, { upsert: true })`);
      dry(`  $setOnInsert → si el usuario ya existe, no pisa contraseña ni rol.`);
      for (const u of seedUsers) {
        dry(`  ${u.correo} (${u.rol})`);
      }
    } else {
      const seedHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
      for (const u of seedUsers) {
        await db.collection(COL_USUARIOS).updateOne(
          { correo: u.correo },
          { $setOnInsert: { ...u, activo: true, password_hash: seedHash } },
          { upsert: true },
        );
        log(`"${u.correo}" (${u.rol}) — creado o sin cambios.`);
      }
    }

    // ── Resumen ────────────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════');
    if (DRY_RUN) {
      console.log('  DRY-RUN completado sin errores. Ningún cambio en Atlas.');
      console.log(`  Base destino verificada: "${DB_NAME}"`);
    } else {
      console.log('  ✅ Script maestro completado.');
      console.log(`     Base: ${DB_NAME} | Host: ${safeHost(MONGODB_URI)}`);
      console.log(`     Colecciones: ${COL_INCIDENCIAS}, ${COL_CONTADORES}, ${COL_USUARIOS}`);
      console.log('     Índices: 4 (compuesto, texto es, TTL 60d, único folio)');
      console.log(`     Docs sintéticos: ${documentos.length} (upsert $setOnInsert)`);
      console.log('     superAdmin: lizandro.reyes (bcrypt, solo primera inserción)');
    }
    console.log('══════════════════════════════════════════════════════\n');

  } finally {
    if (client) {
      await client.close();
      log('Conexión cerrada limpiamente.');
    }
  }
}

main().catch((err) => {
  console.error('\n❌ Error fatal:', err.message);
  process.exit(1);
});

/**
 * database/script_maestro.js
 *
 * Script idempotente de configuración de la base de datos utm_desk.
 * Usa el driver oficial de MongoDB para Node.js (paquete "mongodb")
 * y bcryptjs para hashear contraseñas en tiempo de ejecución.
 *
 * USO:
 *   node script_maestro.js            ← ejecuta contra Atlas
 *   node script_maestro.js --dry-run  ← imprime lo que haría, sin escribir
 *
 * REQUISITOS:
 *   - Archivo .env en esta carpeta (o en la raíz del repo) con:
 *       MONGODB_URI, MONGODB_DB_NAME, SUPER_ADMIN_EMAIL,
 *       SUPER_ADMIN_PASSWORD, SEED_USER_PASSWORD
 *   - npm install  (mongodb, bcryptjs, dotenv)
 *
 * GARANTÍAS DE IDEMPOTENCIA:
 *   - No hace drop de ninguna colección.
 *   - Usa listCollections para decidir entre createCollection y collMod.
 *   - Cada índice tiene nombre explícito; si existe con opciones distintas
 *     se elimina solo ese índice y se recrea.
 *   - El contador usa findOneAndUpdate + upsert (nunca insertOne).
 *   - El superAdmin usa updateOne + upsert (nunca insertOne duplicado).
 *   - Los documentos sintéticos se insertan solo si no existen (upsert por código).
 */

// ── Carga de variables de entorno ────────────────────────────────────────────
// dotenv busca .env subiendo hasta encontrarlo (raíz del repo o database/)
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

import { config } from 'dotenv';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient, ServerApiVersion } from 'mongodb';
import bcrypt from 'bcryptjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Busca .env primero en database/, luego en la raíz del repo
config({ path: resolve(__dirname, '.env') });
config({ path: resolve(__dirname, '..', '.env') }); // no sobreescribe si ya cargó

// ── Modo dry-run ─────────────────────────────────────────────────────────────
const DRY_RUN = process.argv.includes('--dry-run');
if (DRY_RUN) {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  MODO DRY-RUN — no se escribe en Atlas  ║');
  console.log('╚══════════════════════════════════════════╝\n');
}

// ── Importar constantes ──────────────────────────────────────────────────────
import {
  CATEGORIAS, ESTADOS, ESTADOS_CERRADOS, PRIORIDADES, ROLES, TIPOS_REPORTANTE,
  COL_INCIDENCIAS, COL_CONTADORES, COL_USUARIOS,
  IDX_COMPUESTO, IDX_TEXTO, IDX_TTL, IDX_UNICO_FOLIO,
  TTL_SEGUNDOS, CONTADOR_ID, FOLIO_ANIO, FOLIO_PATTERN,
} from './constants.js';

// ── Validar variables de entorno obligatorias ────────────────────────────────
const MONGODB_URI      = process.env.MONGODB_URI;
const DB_NAME          = process.env.MONGODB_DB_NAME ?? 'utm_desk';
// En dry-run usamos el valor del documento oficial como placeholder visible
const SUPER_EMAIL      = process.env.SUPER_ADMIN_EMAIL ?? 'lizandro.reyes@utmetropolitana.edu.mx';
const SUPER_PASSWORD   = process.env.SUPER_ADMIN_PASSWORD;
const SEED_PASSWORD    = process.env.SEED_USER_PASSWORD;

// En dry-run no se conecta a Atlas; solo SUPER_EMAIL se necesita para mostrar el log.
if (!DRY_RUN && !MONGODB_URI)    throw new Error('MONGODB_URI no definida en .env');
if (!DRY_RUN && !SUPER_EMAIL)    throw new Error('SUPER_ADMIN_EMAIL no definida en .env');
if (!DRY_RUN && !SUPER_PASSWORD) throw new Error('SUPER_ADMIN_PASSWORD no definida en .env');
if (!DRY_RUN && !SEED_PASSWORD)  throw new Error('SEED_USER_PASSWORD no definida en .env');

// ── Helpers de log ───────────────────────────────────────────────────────────
const log  = (msg) => console.log(`  ✔ ${msg}`);
const warn = (msg) => console.warn(`  ⚠ ${msg}`);
const dry  = (msg) => console.log(`  [DRY-RUN] ${msg}`);
const section = (title) => console.log(`\n▶ ${title}`);

// ── $jsonSchema del validador ─────────────────────────────────────────────────

/**
 * Construye una rama del oneOf para el validador polimórfico.
 * Cada rama discrimina por "categoria" (enum de un solo valor)
 * y restringe additionalProperties en detalle_especifico.
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

const txt = { bsonType: 'string' };
const num = { bsonType: ['int', 'double'], minimum: 0 };
const fecha = { bsonType: 'date' };
const bool = { bsonType: 'bool' };

const VALIDATOR = {
  $jsonSchema: {
    bsonType: 'object',

    // ── Campos obligatorios en todos los documentos ──────────────────────────
    required: [
      '_id', 'codigo', 'titulo', 'descripcion', 'categoria', 'prioridad',
      'estado', 'reportante', 'ubicacion', 'detalle_especifico',
      'tags', 'historial_seguimiento', 'evidencias', 'horas_invertidas',
      'fecha_creacion',
    ],

    // additionalProperties:false a nivel raíz: se declaran TODOS los campos
    additionalProperties: false,

    properties: {
      _id: {},          // ObjectId generado por el driver; sin restricción de tipo

      codigo: {
        bsonType: 'string',
        pattern: FOLIO_PATTERN,
        description: 'Folio único. Formato INC-AAAA-NNNN.',
      },
      titulo:      { ...txt, description: 'Título breve de la incidencia.' },
      descripcion: { ...txt, description: 'Descripción detallada.' },

      categoria: {
        enum: [...CATEGORIAS],
        description: 'Categoría de la incidencia. Discrimina la rama oneOf.',
      },
      prioridad: {
        enum: [...PRIORIDADES],
        description: 'Nivel de urgencia.',
      },
      estado: {
        enum: [...ESTADOS],
        description: 'Estado actual del ciclo de vida.',
      },

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
          aula:     txt,  // opcional
        },
      },

      // detalle_especifico es validado por el oneOf correspondiente a cada categoría
      detalle_especifico: {
        bsonType: 'object',
        description: 'Subdocumento polimórfico según categoría.',
      },

      tags: {
        bsonType: 'array',
        items: txt,
        description: 'Etiquetas de búsqueda. Sin duplicados (enforced por $addToSet).',
      },

      historial_seguimiento: {
        bsonType: 'array',
        minItems: 1,
        items: {
          bsonType: 'object',
          required: ['fecha', 'autor', 'estado', 'comentario'],
          additionalProperties: false,
          properties: {
            fecha:      fecha,
            autor:      txt,
            estado:     { enum: [...ESTADOS] },
            comentario: txt,
          },
        },
        description: 'Bitácora de cambios de estado. Al menos una entrada.',
      },

      evidencias: {
        bsonType: 'array',
        items: {
          bsonType: 'object',
          required: ['tipo', 'nombre_original', 'storage_path', 'tamano_bytes', 'fecha_carga'],
          additionalProperties: false,
          properties: {
            tipo:           txt,   // MIME type
            nombre_original:txt,
            storage_path:   txt,   // ruta en bucket de Supabase
            tamano_bytes:   { bsonType: ['int', 'double'], minimum: 0 },
            fecha_carga:    fecha,
          },
        },
        description: 'Metadatos de archivos en Supabase Storage (sin URLs; se generan firmadas al consultar).',
      },

      horas_invertidas: {
        ...num,
        description: 'Total de horas dedicadas. Incrementable con $inc.',
      },

      fecha_creacion: {
        ...fecha,
        description: 'Timestamp de creación del documento.',
      },

      // fecha_cierre: OPCIONAL. Solo existe cuando estado ∈ {resuelta, cerrada}.
      // El TTL index apunta a este campo. Se agrega con $set y se quita con $unset.
      fecha_cierre: {
        ...fecha,
        description: 'Fecha en que se resolvió/cerró. Campo del TTL (60 días). Solo presente en resuelta/cerrada.',
      },

      // asignado_a: OPCIONAL. Usuario técnico asignado.
      asignado_a: {
        bsonType: 'object',
        additionalProperties: false,
        properties: {
          nombre: txt,
          correo: txt,
        },
        description: 'Técnico responsable (opcional).',
      },
    },

    // ── Validación polimórfica por categoría ─────────────────────────────────
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
          tipo_dano:           txt,
          nivel_deterioro:     { enum: ['leve', 'moderado', 'severo'] },
          riesgo_seguridad:    { enum: ['bajo', 'medio', 'alto'] },
          requiere_contratista:bool,
        },
        ['tipo_dano', 'nivel_deterioro', 'riesgo_seguridad', 'requiere_contratista'],
      ),

      ramaCategoria(
        'servicios_academicos',
        {
          plataforma:           txt,
          codigo_curso:         txt,
          periodo_escolar:      txt,
          estudiantes_impactados: num,
        },
        ['plataforma', 'codigo_curso', 'periodo_escolar', 'estudiantes_impactados'],
      ),
    ],
  },
};

// ── Generador de datos sintéticos ─────────────────────────────────────────────

/**
 * Genera una fecha relativa al momento de ejecución.
 * @param {number} diasAtras - Cuántos días en el pasado (0 = hoy)
 */
function fechaAtras(diasAtras) {
  const d = new Date();
  d.setDate(d.getDate() - diasAtras);
  d.setHours(Math.floor(Math.random() * 8) + 8, Math.floor(Math.random() * 60), 0, 0);
  return d;
}

/**
 * Crea el objeto de seguimiento inicial al abrir una incidencia.
 */
function seguimientoInicial(fecha, autor) {
  return { fecha, autor, estado: 'abierta', comentario: 'Incidencia registrada en el sistema.' };
}

/**
 * Genera el folio en formato INC-AAAA-NNNN.
 */
function folio(n) {
  return `INC-${FOLIO_ANIO}-${String(n).padStart(4, '0')}`;
}

/**
 * Retorna fecha_cierre solo si el estado lo requiere, y verifica
 * que no sea mayor a 45 días (margen de seguridad ante el TTL de 60 días).
 */
function fechaCierreSegura(diasAtras) {
  // Máximo 45 días para evitar que el TTL borre el doc al instante
  const dias = Math.min(diasAtras, 45);
  return fechaAtras(dias);
}

function generarDocumentos() {
  const ahora = new Date();

  // ── Cómputo y Redes (8 docs) ─────────────────────────────────────────────
  const computo = [
    {
      codigo: folio(1),
      titulo: 'Switch sin señal en Edificio A',
      descripcion: 'El switch del rack principal del Edificio A dejó de responder tras corte de luz.',
      categoria: 'computo_redes',
      prioridad: 'critica',
      estado: 'cerrada',
      reportante: { nombre: 'Carlos Méndez', correo: 'carlos.mendez@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Rack-01' },
      detalle_especifico: { tipo_equipo: 'switch', ip: '192.168.1.1', vlan: 10, puerto_uplink: 'Gi0/1', equipos_afectados: 45 },
      tags: ['red', 'switch', 'corte-luz', 'edificio-a'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(20), 'Carlos Méndez'),
        { fecha: fechaAtras(19), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Técnico revisando switch.' },
        { fecha: fechaAtras(18), autor: 'Luis Mena', estado: 'resuelta', comentario: 'Switch reiniciado y funcional.' },
        { fecha: fechaAtras(17), autor: 'Héctor Poot', estado: 'cerrada', comentario: 'Verificación completada. Caso cerrado.' },
      ],
      evidencias: [],
      horas_invertidas: 6,
      fecha_creacion: fechaAtras(20),
      fecha_cierre: fechaCierreSegura(17),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(2),
      titulo: 'Sin acceso a internet en laboratorio de cómputo L3',
      descripcion: 'Los 30 equipos del laboratorio L3 no tienen salida a internet desde esta mañana.',
      categoria: 'computo_redes',
      prioridad: 'alta',
      estado: 'en_proceso',
      reportante: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio B', aula: 'L3' },
      detalle_especifico: { tipo_equipo: 'router', ip: '10.0.3.1', vlan: 30, puerto_uplink: 'Gi1/0', equipos_afectados: 30 },
      tags: ['internet', 'laboratorio', 'edificio-b'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(3), 'Karla Pech'),
        { fecha: fechaAtras(2), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Revisando configuración del router.' },
      ],
      evidencias: [],
      horas_invertidas: 3,
      fecha_creacion: fechaAtras(3),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(3),
      titulo: 'IP duplicada en VLAN 20 — Administración',
      descripcion: 'Se detectó conflicto de IP en la red administrativa. Dos equipos comparten 192.168.20.50.',
      categoria: 'computo_redes',
      prioridad: 'alta',
      estado: 'resuelta',
      reportante: { nombre: 'María Torres', correo: 'm.torres@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio C', aula: 'Oficina 204' },
      detalle_especifico: { tipo_equipo: 'workstation', ip: '192.168.20.50', vlan: 20, puerto_uplink: 'Gi0/24', equipos_afectados: 2 },
      tags: ['ip-duplicada', 'vlan', 'administracion'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(10), 'María Torres'),
        { fecha: fechaAtras(9), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Identificados los dos equipos en conflicto.' },
        { fecha: fechaAtras(8), autor: 'Luis Mena', estado: 'resuelta', comentario: 'IP reasignada. Conflicto resuelto.' },
      ],
      evidencias: [],
      horas_invertidas: 4,
      fecha_creacion: fechaAtras(10),
      fecha_cierre: fechaCierreSegura(8),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(4),
      titulo: 'Impresora de red sin respuesta — Biblioteca',
      descripcion: 'La impresora HP LaserJet de la biblioteca no responde por red. Posible falla de tarjeta de red.',
      categoria: 'computo_redes',
      prioridad: 'media',
      estado: 'abierta',
      reportante: { nombre: 'Ana López', correo: 'ana.lopez@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Biblioteca', aula: 'Área de impresión' },
      detalle_especifico: { tipo_equipo: 'impresora', ip: '192.168.5.20', vlan: 5, puerto_uplink: 'Fa0/12', equipos_afectados: 1 },
      tags: ['impresora', 'biblioteca', 'red'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(1), 'Ana López'),
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(5),
      titulo: 'Access point caído — Sala de Maestros EdifB',
      descripcion: 'El access point Cisco del segundo piso del Edificio B no emite señal WiFi.',
      categoria: 'computo_redes',
      prioridad: 'media',
      estado: 'en_espera',
      reportante: { nombre: 'Prof. Roberto Dzul', correo: 'r.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'Sala de Maestros' },
      detalle_especifico: { tipo_equipo: 'access_point', ip: '10.0.2.45', vlan: 2, puerto_uplink: 'Gi0/5', equipos_afectados: 15 },
      tags: ['wifi', 'access-point', 'edificio-b'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(5), 'Prof. Roberto Dzul'),
        { fecha: fechaAtras(4), autor: 'Luis Mena', estado: 'en_espera', comentario: 'En espera de refacción (AP de reemplazo).' },
      ],
      evidencias: [],
      horas_invertidas: 1,
      fecha_creacion: fechaAtras(5),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(6),
      titulo: 'Servidor de archivos lento — EdifA',
      descripcion: 'El servidor NAS del Edificio A presenta latencias de 2000ms. Se sospecha disco en falla.',
      categoria: 'computo_redes',
      prioridad: 'alta',
      estado: 'en_proceso',
      reportante: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio A', aula: 'Cuarto de servidores' },
      detalle_especifico: { tipo_equipo: 'servidor_nas', ip: '192.168.1.10', vlan: 10, puerto_uplink: 'Gi0/2', equipos_afectados: 60 },
      tags: ['servidor', 'nas', 'latencia', 'disco'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(7), 'Héctor Poot'),
        { fecha: fechaAtras(6), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'SMART test muestra sectores defectuosos. Iniciando reemplazo de disco.' },
      ],
      evidencias: [],
      horas_invertidas: 8,
      fecha_creacion: fechaAtras(7),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(7),
      titulo: 'Firewall bloqueando plataforma Moodle',
      descripcion: 'Regla del firewall bloquea el puerto 443 hacia el servidor de Moodle para equipos de la VLAN 40.',
      categoria: 'computo_redes',
      prioridad: 'critica',
      estado: 'resuelta',
      reportante: { nombre: 'Dra. Lucía Can', correo: 'l.can@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 101' },
      detalle_especifico: { tipo_equipo: 'firewall', ip: '10.0.0.1', vlan: 40, puerto_uplink: 'Gi1/1', equipos_afectados: 80 },
      tags: ['firewall', 'moodle', 'bloqueo', 'vlan-40'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(15), 'Dra. Lucía Can'),
        { fecha: fechaAtras(14), autor: 'Luis Mena', estado: 'en_proceso', comentario: 'Identificada la regla errónea en el firewall.' },
        { fecha: fechaAtras(13), autor: 'Luis Mena', estado: 'resuelta', comentario: 'Regla eliminada. Acceso a Moodle restaurado.' },
      ],
      evidencias: [],
      horas_invertidas: 5,
      fecha_creacion: fechaAtras(15),
      fecha_cierre: fechaCierreSegura(13),
      asignado_a: { nombre: 'Luis Mena', correo: 'luis.mena@utmdesk.test' },
    },
    {
      codigo: folio(8),
      titulo: 'Cableado dañado — Laboratorio L1',
      descripcion: 'Cables de red visiblemente dañados en el pasacables del laboratorio L1. Pérdida de paquetes del 60%.',
      categoria: 'computo_redes',
      prioridad: 'alta',
      estado: 'abierta',
      reportante: { nombre: 'Prof. Iván Uicab', correo: 'i.uicab@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'L1' },
      detalle_especifico: { tipo_equipo: 'cableado', ip: 'N/A', vlan: 30, puerto_uplink: 'Fa0/8', equipos_afectados: 25 },
      tags: ['cableado', 'laboratorio', 'perdida-paquetes'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(2), 'Prof. Iván Uicab'),
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: fechaAtras(2),
    },
  ];

  // ── Infraestructura Física (9 docs) ──────────────────────────────────────
  const infra = [
    {
      codigo: folio(9),
      titulo: 'Fuga de agua en techo — Edificio C, Aula 305',
      descripcion: 'Infiltración de agua en el techo del aula 305 tras lluvias. Riesgo de cortocircuito.',
      categoria: 'infraestructura_fisica',
      prioridad: 'critica',
      estado: 'en_proceso',
      reportante: { nombre: 'Prof. Sandra Xool', correo: 's.xool@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio C', aula: 'Aula 305' },
      detalle_especifico: { tipo_dano: 'infiltración_agua', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['fuga', 'agua', 'techo', 'edificio-c', 'electrico'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(4), 'Prof. Sandra Xool'),
        { fecha: fechaAtras(3), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Cotización de reparación en trámite con proveedor.' },
      ],
      evidencias: [],
      horas_invertidas: 2,
      fecha_creacion: fechaAtras(4),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(10),
      titulo: 'Puerta de emergencia bloqueada — Edificio A',
      descripcion: 'La palanca de la salida de emergencia del primer piso del Edificio A no acciona.',
      categoria: 'infraestructura_fisica',
      prioridad: 'critica',
      estado: 'resuelta',
      reportante: { nombre: 'Vigilante turno matutino', correo: 'vigilancia@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio A', aula: 'Salida norte' },
      detalle_especifico: { tipo_dano: 'puerta_emergencia', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: false },
      tags: ['emergencia', 'puerta', 'seguridad', 'edificio-a'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(30), 'Vigilante turno matutino'),
        { fecha: fechaAtras(29), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Técnico de mantenimiento revisando.' },
        { fecha: fechaAtras(28), autor: 'Héctor Poot', estado: 'resuelta', comentario: 'Mecanismo reparado. Puerta operativa.' },
      ],
      evidencias: [],
      horas_invertidas: 3,
      fecha_creacion: fechaAtras(30),
      fecha_cierre: fechaCierreSegura(28),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(11),
      titulo: 'Luminaria fundida — Pasillo principal EdifB',
      descripcion: 'Tres luminarias del pasillo principal del Edificio B están fundidas, creando zona oscura.',
      categoria: 'infraestructura_fisica',
      prioridad: 'media',
      estado: 'cerrada',
      reportante: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio B', aula: 'Pasillo principal' },
      detalle_especifico: { tipo_dano: 'luminaria', nivel_deterioro: 'leve', riesgo_seguridad: 'medio', requiere_contratista: false },
      tags: ['luminaria', 'electricidad', 'edificio-b'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(40), 'Karla Pech'),
        { fecha: fechaAtras(39), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Focos de reemplazo adquiridos.' },
        { fecha: fechaAtras(38), autor: 'Héctor Poot', estado: 'resuelta', comentario: 'Luminarias reemplazadas.' },
        { fecha: fechaAtras(37), autor: 'Héctor Poot', estado: 'cerrada', comentario: 'Caso cerrado tras verificación.' },
      ],
      evidencias: [],
      horas_invertidas: 2,
      fecha_creacion: fechaAtras(40),
      fecha_cierre: fechaCierreSegura(37),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(12),
      titulo: 'Vidrio roto — ventana Aula 112 EdifD',
      descripcion: 'Ventana del aula 112 tiene el vidrio fragmentado. Riesgo de corte.',
      categoria: 'infraestructura_fisica',
      prioridad: 'alta',
      estado: 'abierta',
      reportante: { nombre: 'Prof. Elena Canul', correo: 'e.canul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 112' },
      detalle_especifico: { tipo_dano: 'vidrio_roto', nivel_deterioro: 'moderado', riesgo_seguridad: 'medio', requiere_contratista: false },
      tags: ['vidrio', 'ventana', 'riesgo'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(1), 'Prof. Elena Canul'),
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(13),
      titulo: 'Baño fuera de servicio — EdifC, planta baja',
      descripcion: 'Sanitario masculino de planta baja con tubería rota y acumulación de agua.',
      categoria: 'infraestructura_fisica',
      prioridad: 'alta',
      estado: 'en_proceso',
      reportante: { nombre: 'Ana López', correo: 'ana.lopez@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio C', aula: 'Baño planta baja' },
      detalle_especifico: { tipo_dano: 'tuberia_rota', nivel_deterioro: 'severo', riesgo_seguridad: 'medio', requiere_contratista: true },
      tags: ['plomeria', 'bano', 'edificio-c'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(6), 'Ana López'),
        { fecha: fechaAtras(5), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Plomero externo contratado. Trabajo en progreso.' },
      ],
      evidencias: [],
      horas_invertidas: 4,
      fecha_creacion: fechaAtras(6),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(14),
      titulo: 'Aire acondicionado ruidoso — Sala de Cómputo EdifA',
      descripcion: 'El A/C de la sala de cómputo del Edificio A hace ruido excesivo y vibración. No enfría correctamente.',
      categoria: 'infraestructura_fisica',
      prioridad: 'baja',
      estado: 'en_espera',
      reportante: { nombre: 'Prof. Iván Uicab', correo: 'i.uicab@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Sala de Cómputo' },
      detalle_especifico: { tipo_dano: 'aire_acondicionado', nivel_deterioro: 'leve', riesgo_seguridad: 'bajo', requiere_contratista: true },
      tags: ['aire-acondicionado', 'ruido', 'edificio-a'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(12), 'Prof. Iván Uicab'),
        { fecha: fechaAtras(11), autor: 'Héctor Poot', estado: 'en_espera', comentario: 'En espera de autorización presupuestal.' },
      ],
      evidencias: [],
      horas_invertidas: 1,
      fecha_creacion: fechaAtras(12),
    },
    {
      codigo: folio(15),
      titulo: 'Rampa para silla de ruedas dañada — Entrada principal',
      descripcion: 'La rampa de acceso principal tiene grietas profundas y pernos expuestos.',
      categoria: 'infraestructura_fisica',
      prioridad: 'alta',
      estado: 'abierta',
      reportante: { nombre: 'María Torres', correo: 'm.torres@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Entrada norte' },
      detalle_especifico: { tipo_dano: 'rampa_daniada', nivel_deterioro: 'moderado', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['accesibilidad', 'rampa', 'seguridad', 'entrada'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(3), 'María Torres'),
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: fechaAtras(3),
    },
    {
      codigo: folio(16),
      titulo: 'Extinguidor vencido — Edificio D, 2do piso',
      descripcion: 'El extintor del segundo piso del Edificio D tiene fecha de recarga vencida hace 3 meses.',
      categoria: 'infraestructura_fisica',
      prioridad: 'critica',
      estado: 'resuelta',
      reportante: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio D', aula: 'Pasillo 2do piso' },
      detalle_especifico: { tipo_dano: 'extintor_vencido', nivel_deterioro: 'moderado', riesgo_seguridad: 'alto', requiere_contratista: false },
      tags: ['extintor', 'seguridad', 'contra-incendios'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(25), 'Héctor Poot'),
        { fecha: fechaAtras(24), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Solicitada recarga con empresa certificada.' },
        { fecha: fechaAtras(22), autor: 'Héctor Poot', estado: 'resuelta', comentario: 'Extintor recargado y certificado.' },
      ],
      evidencias: [],
      horas_invertidas: 3,
      fecha_creacion: fechaAtras(25),
      fecha_cierre: fechaCierreSegura(22),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
    {
      codigo: folio(17),
      titulo: 'Escalera sin barandal — Edificio B',
      descripcion: 'El barandal de la escalera norte del Edificio B está desprendido. Riesgo de caída.',
      categoria: 'infraestructura_fisica',
      prioridad: 'alta',
      estado: 'en_proceso',
      reportante: { nombre: 'Prof. Roberto Dzul', correo: 'r.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio B', aula: 'Escalera norte' },
      detalle_especifico: { tipo_dano: 'barandal_desprendido', nivel_deterioro: 'severo', riesgo_seguridad: 'alto', requiere_contratista: true },
      tags: ['barandal', 'escalera', 'caida', 'edificio-b'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(8), 'Prof. Roberto Dzul'),
        { fecha: fechaAtras(7), autor: 'Héctor Poot', estado: 'en_proceso', comentario: 'Zona acordonada. Empresa contratada para soldadura.' },
      ],
      evidencias: [],
      horas_invertidas: 2,
      fecha_creacion: fechaAtras(8),
      asignado_a: { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test' },
    },
  ];

  // ── Servicios Académicos (8 docs) ─────────────────────────────────────────
  const academico = [
    {
      codigo: folio(18),
      titulo: 'Moodle sin acceso para grupo 3-A Ing. Software',
      descripcion: 'Los alumnos del grupo 3-A no pueden acceder a la asignatura de Bases de Datos en Moodle.',
      categoria: 'servicios_academicos',
      prioridad: 'alta',
      estado: 'resuelta',
      reportante: { nombre: 'Dra. Lucía Can', correo: 'l.can@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 205' },
      detalle_especifico: { plataforma: 'Moodle', codigo_curso: 'BD-2026-3A', periodo_escolar: '2026-1', estudiantes_impactados: 28 },
      tags: ['moodle', 'acceso', 'bases-de-datos', '3A'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(18), 'Dra. Lucía Can'),
        { fecha: fechaAtras(17), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Revisando permisos del curso.' },
        { fecha: fechaAtras(16), autor: 'Karla Pech', estado: 'resuelta', comentario: 'Permisos corregidos. Alumnos con acceso.' },
      ],
      evidencias: [],
      horas_invertidas: 3,
      fecha_creacion: fechaAtras(18),
      fecha_cierre: fechaCierreSegura(16),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(19),
      titulo: 'Plataforma Teams caída durante examen parcial',
      descripcion: 'Teams dejó de funcionar durante el examen parcial del grupo 2-B de Sistemas. Alumnos sin sesión.',
      categoria: 'servicios_academicos',
      prioridad: 'critica',
      estado: 'cerrada',
      reportante: { nombre: 'Prof. Alberto Cob', correo: 'a.cob@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio A', aula: 'Aula 108' },
      detalle_especifico: { plataforma: 'Microsoft Teams', codigo_curso: 'SIS-2026-2B', periodo_escolar: '2026-1', estudiantes_impactados: 35 },
      tags: ['teams', 'examen', 'caida', 'parcial'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(35), 'Prof. Alberto Cob'),
        { fecha: fechaAtras(34), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Incidencia reportada a Microsoft. Examen reprogramado.' },
        { fecha: fechaAtras(33), autor: 'Karla Pech', estado: 'resuelta', comentario: 'Servicio restaurado. Examen realizado.' },
        { fecha: fechaAtras(32), autor: 'Héctor Poot', estado: 'cerrada', comentario: 'Caso documentado. Cerrado.' },
      ],
      evidencias: [],
      horas_invertidas: 6,
      fecha_creacion: fechaAtras(35),
      fecha_cierre: fechaCierreSegura(32),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(20),
      titulo: 'Cuenta institucional bloqueada — alumno nuevo',
      descripcion: 'Alumno de nuevo ingreso no puede activar su cuenta de correo @utmetropolitana.edu.mx.',
      categoria: 'servicios_academicos',
      prioridad: 'media',
      estado: 'en_proceso',
      reportante: { nombre: 'Diego Tuz', correo: 'diego.tuz@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Servicio Escolar' },
      detalle_especifico: { plataforma: 'Google Workspace', codigo_curso: 'INGRESO-2026', periodo_escolar: '2026-1', estudiantes_impactados: 1 },
      tags: ['cuenta', 'correo', 'nuevo-ingreso', 'google-workspace'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(2), 'Diego Tuz'),
        { fecha: fechaAtras(1), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Verificando matrícula en sistema escolar.' },
      ],
      evidencias: [],
      horas_invertidas: 1,
      fecha_creacion: fechaAtras(2),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(21),
      titulo: 'Calificaciones no reflejadas en sistema — 4-A ITA',
      descripcion: 'Las calificaciones del parcial II del grupo 4-A de ITA no aparecen en el sistema de control escolar.',
      categoria: 'servicios_academicos',
      prioridad: 'alta',
      estado: 'abierta',
      reportante: { nombre: 'Prof. Mariana Dzul', correo: 'm.dzul@utmetropolitana.edu.mx', tipo: 'docente' },
      ubicacion: { edificio: 'Edificio D', aula: 'Aula 310' },
      detalle_especifico: { plataforma: 'SIIA', codigo_curso: 'ITA-2026-4A', periodo_escolar: '2026-1', estudiantes_impactados: 32 },
      tags: ['calificaciones', 'siia', 'control-escolar', '4A'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(1), 'Prof. Mariana Dzul'),
      ],
      evidencias: [],
      horas_invertidas: 0,
      fecha_creacion: fechaAtras(1),
    },
    {
      codigo: folio(22),
      titulo: 'Videoconferencia sin audio — Sala de videoconferencias',
      descripcion: 'El sistema de videoconferencia de la sala principal no transmite audio en reuniones remotas.',
      categoria: 'servicios_academicos',
      prioridad: 'alta',
      estado: 'en_espera',
      reportante: { nombre: 'Director académico', correo: 'direccion@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Sala de videoconferencias' },
      detalle_especifico: { plataforma: 'Zoom Rooms', codigo_curso: 'ADM-2026', periodo_escolar: '2026-1', estudiantes_impactados: 0 },
      tags: ['videoconferencia', 'audio', 'zoom', 'sala'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(9), 'Director académico'),
        { fecha: fechaAtras(8), autor: 'Karla Pech', estado: 'en_espera', comentario: 'En espera de técnico especialista en AV.' },
      ],
      evidencias: [],
      horas_invertidas: 2,
      fecha_creacion: fechaAtras(9),
    },
    {
      codigo: folio(23),
      titulo: 'Biblioteca digital sin acceso — Bases de datos académicas',
      descripcion: 'Los accesos a EBSCO y Redalyc están caídos para todos los usuarios de la institución.',
      categoria: 'servicios_academicos',
      prioridad: 'media',
      estado: 'resuelta',
      reportante: { nombre: 'Bibliotecaria', correo: 'biblioteca@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Biblioteca', aula: 'Sala digital' },
      detalle_especifico: { plataforma: 'EBSCO / Redalyc', codigo_curso: 'BIBLIOTECA-2026', periodo_escolar: '2026-1', estudiantes_impactados: 500 },
      tags: ['biblioteca-digital', 'ebsco', 'redalyc', 'investigacion'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(14), 'Bibliotecaria'),
        { fecha: fechaAtras(13), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Contactando al proveedor de licencias.' },
        { fecha: fechaAtras(12), autor: 'Karla Pech', estado: 'resuelta', comentario: 'Licencias renovadas. Acceso restaurado.' },
      ],
      evidencias: [],
      horas_invertidas: 4,
      fecha_creacion: fechaAtras(14),
      fecha_cierre: fechaCierreSegura(12),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(24),
      titulo: 'Error al subir tarea en Moodle — grupo 1-A Admon',
      descripcion: 'Alumnos del grupo 1-A de Administración no pueden subir archivos mayores a 5MB en la tarea de Estadística.',
      categoria: 'servicios_academicos',
      prioridad: 'baja',
      estado: 'resuelta',
      reportante: { nombre: 'Sofía Cupul', correo: 's.cupul@utmdesk.test', tipo: 'estudiante' },
      ubicacion: { edificio: 'Edificio C', aula: 'Aula 201' },
      detalle_especifico: { plataforma: 'Moodle', codigo_curso: 'ADMON-2026-1A', periodo_escolar: '2026-1', estudiantes_impactados: 30 },
      tags: ['moodle', 'subida-archivos', 'limite-tamano'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(22), 'Sofía Cupul'),
        { fecha: fechaAtras(21), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Aumentando límite de subida en configuración del curso.' },
        { fecha: fechaAtras(20), autor: 'Karla Pech', estado: 'resuelta', comentario: 'Límite aumentado a 50MB. Alumnos pueden subir.' },
      ],
      evidencias: [],
      horas_invertidas: 2,
      fecha_creacion: fechaAtras(22),
      fecha_cierre: fechaCierreSegura(20),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
    {
      codigo: folio(25),
      titulo: 'Generador de horarios fuera de línea — inicio de semestre',
      descripcion: 'El sistema SIIA para generación de horarios del semestre 2026-2 no carga para ningún docente.',
      categoria: 'servicios_academicos',
      prioridad: 'critica',
      estado: 'en_proceso',
      reportante: { nombre: 'Coordinadora académica', correo: 'coordinacion@utmetropolitana.edu.mx', tipo: 'administrativo' },
      ubicacion: { edificio: 'Edificio Principal', aula: 'Coordinación académica' },
      detalle_especifico: { plataforma: 'SIIA', codigo_curso: 'HORARIOS-2026-2', periodo_escolar: '2026-2', estudiantes_impactados: 800 },
      tags: ['siia', 'horarios', 'inicio-semestre', 'critico'],
      historial_seguimiento: [
        seguimientoInicial(fechaAtras(5), 'Coordinadora académica'),
        { fecha: fechaAtras(4), autor: 'Karla Pech', estado: 'en_proceso', comentario: 'Escalado al proveedor del SIIA. Esperando parche.' },
      ],
      evidencias: [],
      horas_invertidas: 5,
      fecha_creacion: fechaAtras(5),
      asignado_a: { nombre: 'Karla Pech', correo: 'karla.pech@utmdesk.test' },
    },
  ];

  return [...computo, ...infra, ...academico]; // 25 documentos en total
}

// ── FUNCIÓN PRINCIPAL ─────────────────────────────────────────────────────────

async function main() {
  let client;

  try {
    // ── 1. Conexión ──────────────────────────────────────────────────────────
    section('1. Conexión a MongoDB Atlas');
    if (DRY_RUN) {
      dry(`MongoClient.connect(MONGODB_URI) → base de datos "${DB_NAME}"`);
    } else {
      client = new MongoClient(MONGODB_URI, {
        serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
      });
      await client.connect();
      log(`Conectado a Atlas — base de datos: ${DB_NAME}`);
    }

    const db = DRY_RUN ? null : client.db(DB_NAME);

    // ── 2. Colección incidencias_campus ──────────────────────────────────────
    section(`2. Colección "${COL_INCIDENCIAS}"`);

    if (DRY_RUN) {
      dry(`listCollections({ name: "${COL_INCIDENCIAS}" }) → si no existe: createCollection con $jsonSchema`);
      dry(`Si ya existe: collMod con el validador actualizado (validationLevel: strict, validationAction: error)`);
    } else {
      const cols = await db.listCollections({ name: COL_INCIDENCIAS }).toArray();
      if (cols.length === 0) {
        await db.createCollection(COL_INCIDENCIAS, {
          validator: VALIDATOR,
          validationLevel: 'strict',
          validationAction: 'error',
        });
        log(`Colección "${COL_INCIDENCIAS}" creada con validador $jsonSchema.`);
      } else {
        await db.command({
          collMod: COL_INCIDENCIAS,
          validator: VALIDATOR,
          validationLevel: 'strict',
          validationAction: 'error',
        });
        log(`Colección "${COL_INCIDENCIAS}" ya existía → validador actualizado con collMod.`);
      }
    }

    // ── 3. Colecciones auxiliares ────────────────────────────────────────────
    section('3. Colecciones auxiliares (contadores, usuarios)');

    for (const nombre of [COL_CONTADORES, COL_USUARIOS]) {
      if (DRY_RUN) {
        dry(`listCollections({ name: "${nombre}" }) → createCollection si no existe`);
      } else {
        const existe = (await db.listCollections({ name: nombre }).toArray()).length > 0;
        if (!existe) {
          await db.createCollection(nombre);
          log(`Colección "${nombre}" creada.`);
        } else {
          log(`Colección "${nombre}" ya existe — sin cambios.`);
        }
      }
    }

    // ── 4. Índices de incidencias_campus ─────────────────────────────────────
    section(`4. Índices en "${COL_INCIDENCIAS}"`);

    const indicesDeseados = [
      {
        name: IDX_COMPUESTO,
        key: { categoria: 1, estado: 1, 'ubicacion.edificio': 1 },
        options: {},
      },
      {
        name: IDX_TEXTO,
        key: { titulo: 'text', descripcion: 'text', tags: 'text' },
        options: { default_language: 'spanish', weights: { titulo: 10, descripcion: 5, tags: 3 } },
      },
      {
        name: IDX_TTL,
        key: { fecha_cierre: 1 },
        options: { expireAfterSeconds: TTL_SEGUNDOS, sparse: true },
      },
      {
        name: IDX_UNICO_FOLIO,
        key: { codigo: 1 },
        options: { unique: true },
      },
    ];

    if (DRY_RUN) {
      for (const idx of indicesDeseados) {
        dry(`createIndex(${JSON.stringify(idx.key)}, { name: "${idx.name}", ...opciones })`);
      }
    } else {
      const col = db.collection(COL_INCIDENCIAS);
      const existentes = await col.indexes();
      const existentesPorNombre = Object.fromEntries(existentes.map(i => [i.name, i]));

      for (const idx of indicesDeseados) {
        if (existentesPorNombre[idx.name]) {
          // El índice existe. Verificamos si las opciones clave son iguales.
          // Para texto, el driver puede crear el nombre automáticamente como "titulo_text_..."
          // pero nosotros lo nombramos explícitamente, así que si el nombre coincide lo respetamos.
          log(`Índice "${idx.name}" ya existe — sin cambios.`);
        } else {
          // Detectar si hay un índice de texto existente sin nombre explícito (auto-generado)
          // que colisione con el que queremos crear.
          if (idx.key[Object.keys(idx.key)[0]] === 'text') {
            const textoExistente = existentes.find(
              i => i.name !== '_id_' && Object.values(i.key ?? {}).includes('text'),
            );
            if (textoExistente) {
              warn(`Índice de texto existente "${textoExistente.name}" sin nombre correcto → eliminando y recreando.`);
              await col.dropIndex(textoExistente.name);
            }
          }
          await col.createIndex(idx.key, { name: idx.name, ...idx.options });
          log(`Índice "${idx.name}" creado.`);
        }
      }
    }

    // ── 5. Datos sintéticos ──────────────────────────────────────────────────
    section('5. Documentos sintéticos (25 docs, upsert por código)');

    const documentos = generarDocumentos();

    if (DRY_RUN) {
      dry(`${documentos.length} documentos a insertar/actualizar (upsert por campo "codigo").`);
      dry('Categorías: ' + [
        `computo_redes ×${documentos.filter(d => d.categoria === 'computo_redes').length}`,
        `infraestructura_fisica ×${documentos.filter(d => d.categoria === 'infraestructura_fisica').length}`,
        `servicios_academicos ×${documentos.filter(d => d.categoria === 'servicios_academicos').length}`,
      ].join(', '));
      dry('Estados: ' + ESTADOS.map(
        e => `${e} ×${documentos.filter(d => d.estado === e).length}`
      ).join(', '));
      dry('Docs con fecha_cierre (TTL activo): ' + documentos.filter(d => d.fecha_cierre).length);
      dry('Fecha de ejecución base (todas las fechas son relativas): ' + new Date().toISOString());
    } else {
      const col = db.collection(COL_INCIDENCIAS);
      let insertados = 0;
      let actualizados = 0;

      for (const doc of documentos) {
        const { codigo, ...resto } = doc;
        const result = await col.updateOne(
          { codigo },
          { $setOnInsert: { codigo, ...resto } },
          { upsert: true },
        );
        if (result.upsertedCount > 0) insertados++;
        else actualizados++;
      }
      log(`Documentos insertados: ${insertados}, ya existían (sin cambios): ${actualizados}.`);
    }

    // ── 6. Contador — último folio usado ─────────────────────────────────────
    section('6. Contador de folios');

    const ultimoFolio = documentos.length; // == 25

    if (DRY_RUN) {
      dry(`findOneAndUpdate({ _id: "${CONTADOR_ID}" }, { $max: { ultimo: ${ultimoFolio} } }, { upsert: true })`);
      dry(`Resultado esperado: { _id: "${CONTADOR_ID}", ultimo: ${ultimoFolio} }`);
    } else {
      const result = await db.collection(COL_CONTADORES).findOneAndUpdate(
        { _id: CONTADOR_ID },
        // $max garantiza que no bajamos el contador si ya tiene un valor mayor
        { $max: { ultimo: ultimoFolio } },
        { upsert: true, returnDocument: 'after' },
      );
      log(`Contador "${CONTADOR_ID}" → ultimo: ${result.ultimo}`);
    }

    // ── 7. superAdmin lizandro.reyes ─────────────────────────────────────────
    section('7. superAdmin lizandro.reyes');

    const BCRYPT_ROUNDS = 12;

    if (DRY_RUN) {
      dry(`bcryptjs.hash(SUPER_ADMIN_PASSWORD, ${BCRYPT_ROUNDS}) → password_hash`);
      dry(`updateOne({ correo: "${SUPER_EMAIL}" }, { $set: { nombre, correo, rol, activo, password_hash } }, { upsert: true })`);
    } else {
      const superHash = await bcrypt.hash(SUPER_PASSWORD, BCRYPT_ROUNDS);
      const superAdmin = {
        nombre:        'lizandro.reyes',
        correo:        SUPER_EMAIL,
        rol:           'superAdmin',
        activo:        true,
        password_hash: superHash,
      };
      await db.collection(COL_USUARIOS).updateOne(
        { correo: SUPER_EMAIL },
        { $set: superAdmin },
        { upsert: true },
      );
      log(`superAdmin "${SUPER_EMAIL}" creado/actualizado (hash bcrypt, ${BCRYPT_ROUNDS} rondas).`);
    }

    // ── 8. Usuarios de prueba ────────────────────────────────────────────────
    section('8. Usuarios de prueba (seed)');

    const seedUsers = [
      { nombre: 'Karla Pech',  correo: 'karla.pech@utmdesk.test',  rol: 'reportante'   },
      { nombre: 'Luis Mena',   correo: 'luis.mena@utmdesk.test',   rol: 'tecnico'       },
      { nombre: 'Héctor Poot', correo: 'hector.poot@utmdesk.test', rol: 'administrador' },
    ];

    if (DRY_RUN) {
      dry(`bcryptjs.hash(SEED_USER_PASSWORD, ${BCRYPT_ROUNDS}) → seedHash`);
      for (const u of seedUsers) {
        dry(`upsert usuario { correo: "${u.correo}", rol: "${u.rol}" }`);
      }
    } else {
      const seedHash = await bcrypt.hash(SEED_PASSWORD, BCRYPT_ROUNDS);
      for (const u of seedUsers) {
        await db.collection(COL_USUARIOS).updateOne(
          { correo: u.correo },
          { $set: { ...u, activo: true, password_hash: seedHash } },
          { upsert: true },
        );
        log(`Usuario "${u.correo}" (${u.rol}) creado/actualizado.`);
      }
    }

    // ── Resumen final ────────────────────────────────────────────────────────
    console.log('\n══════════════════════════════════════════════════════');
    if (DRY_RUN) {
      console.log('  DRY-RUN completado sin errores. Sin cambios en Atlas.');
    } else {
      console.log('  ✅ Script maestro completado con éxito.');
      console.log(`     Base de datos: ${DB_NAME}`);
      console.log('     Colecciones configuradas: incidencias_campus, contadores, usuarios');
      console.log('     Índices: 4 (compuesto, texto, TTL, único)');
      console.log('     Documentos sintéticos: 25 (upsert idempotente)');
      console.log('     superAdmin: lizandro.reyes (bcrypt 12 rondas)');
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

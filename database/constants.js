/**
 * database/constants.js
 *
 * Bloque único de constantes compartidas entre el script maestro,
 * verify.js y (Fase 3) la capa de datos del backend.
 *
 * FUENTE DE VERDAD para nombres de colecciones, índices y enumeraciones.
 * Importar desde aquí; no repetir literales en otros archivos.
 *
 * NOTA PARA EL EQUIPO: Cristian (líder) debe confirmar los valores de
 * los enums antes de propagarlos al frontend y otras ramas.
 * Las ramas del equipo usan actualmente espacios ("en proceso") y nombres
 * cortos ("infraestructura", "academico"). dev-isaac los migra a snake_case.
 */

// ── Base de datos ─────────────────────────────────────────────────────────────

/** Nombre de la base de datos en Atlas (puede sobreescribirse con MONGODB_DB_NAME en .env) */
export const DB_NAME = 'utm_desk';

// ── Nombres de colecciones ────────────────────────────────────────────────────

export const COL_INCIDENCIAS = 'incidencias_campus';
export const COL_CONTADORES  = 'contadores';
export const COL_USUARIOS    = 'usuarios';

// ── Enumeraciones ─────────────────────────────────────────────────────────────

export const CATEGORIAS = /** @type {const} */ ([
  'computo_redes',
  'infraestructura_fisica',
  'servicios_academicos',
]);

export const ESTADOS = /** @type {const} */ ([
  'abierta',
  'en_proceso',
  'en_espera',
  'resuelta',
  'cerrada',
]);

/** Estados que requieren fecha_cierre (activan TTL de 60 días) */
export const ESTADOS_CERRADOS = /** @type {const} */ (['resuelta', 'cerrada']);

export const PRIORIDADES = /** @type {const} */ ([
  'baja',
  'media',
  'alta',
  'critica',
]);

export const ROLES = /** @type {const} */ ([
  'reportante',
  'tecnico',
  'administrador',
  'auditor',
  'superAdmin',
]);

export const TIPOS_REPORTANTE = /** @type {const} */ ([
  'estudiante',
  'docente',
  'administrativo',
]);

// ── Nombres de índices (explícitos para idempotencia) ─────────────────────────

export const IDX_COMPUESTO    = 'idx_categoria_estado_edificio';
export const IDX_TEXTO        = 'idx_texto_espanol';
export const IDX_TTL          = 'idx_ttl_fecha_cierre';
export const IDX_UNICO_FOLIO  = 'idx_unico_codigo';
export const IDX_UNICO_CORREO = 'idx_unico_correo';

// ── TTL ───────────────────────────────────────────────────────────────────────

/** 60 días en segundos */
export const TTL_SEGUNDOS = 5_184_000;

// ── Folio ─────────────────────────────────────────────────────────────────────

export const CONTADOR_ID   = 'folio-2026';
export const FOLIO_ANIO    = '2026';
export const FOLIO_PATTERN = '^INC-\\d{4}-\\d{4}$';

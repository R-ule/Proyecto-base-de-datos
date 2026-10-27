/**
 * database/constants.js
 *
 * Bloque único de constantes compartidas entre el script maestro,
 * verify.js y (en Fase 3) la capa de datos del backend.
 *
 * NOTA PARA EL EQUIPO: Cristian (líder) debe confirmar estos valores
 * antes de que se propaguen al frontend o a otras ramas.
 * Los valores actuales en origin/main usan espacios ("en proceso",
 * "en espera") y nombres cortos ("infraestructura", "academico").
 * Esta rama (dev-isaac) los migra a snake_case y nombres completos.
 */

// ── Enumeraciones ────────────────────────────────────────────────────────────

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

/** Estados que marcan una incidencia como cerrada (activan fecha_cierre y TTL) */
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
  'superAdmin',
]);

export const TIPOS_REPORTANTE = /** @type {const} */ ([
  'estudiante',
  'docente',
  'administrativo',
]);

// ── Nombres de colecciones ───────────────────────────────────────────────────

export const COL_INCIDENCIAS = 'incidencias_campus';
export const COL_CONTADORES  = 'contadores';
export const COL_USUARIOS    = 'usuarios';

// ── Nombres de índices (explícitos para idempotencia) ────────────────────────

export const IDX_COMPUESTO   = 'idx_categoria_estado_edificio';
export const IDX_TEXTO       = 'idx_texto_espanol';
export const IDX_TTL         = 'idx_ttl_fecha_cierre';
export const IDX_UNICO_FOLIO = 'idx_unico_codigo';

// ── TTL ──────────────────────────────────────────────────────────────────────

/** 60 días en segundos */
export const TTL_SEGUNDOS = 5_184_000;

// ── Folio ────────────────────────────────────────────────────────────────────

export const CONTADOR_ID     = 'folio-2026';
export const FOLIO_ANIO      = '2026';
export const FOLIO_PATTERN   = '^INC-\\d{4}-\\d{4}$';

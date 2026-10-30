import type { IconName } from './icon.component';

// ---------- Estados y prioridades ----------
export type Estado = 'Recibido' | 'Asignado' | 'En atención' | 'Resuelto';

export const ESTADOS: Estado[] = ['Recibido', 'Asignado', 'En atención', 'Resuelto'];

export const ESTADO_CLASE: Record<Estado, string> = {
  Recibido: 'recibido',
  Asignado: 'asignado',
  'En atención': 'atencion',
  Resuelto: 'resuelto',
};

export type Prioridad = 'Baja' | 'Media' | 'Alta' | 'Crítica';

/** De mayor a menor prioridad (el índice sirve para ordenar). */
export const PRIORIDADES: Prioridad[] = ['Crítica', 'Alta', 'Media', 'Baja'];

export const PRIORIDAD_CLASE: Record<Prioridad, string> = {
  Baja: 'baja',
  Media: 'media',
  Alta: 'alta',
  Crítica: 'critica',
};

// ---------- Incidencias ----------
export interface Incidencia {
  folio: string;
  titulo: string;
  categoria: string;
  edificio: string;
  area: string;
  estado: Estado;
  actualizada: Date;
  /** Texto corto del avance (solo reportes que se siguen). */
  detalle?: string;
  /** Hay una actualización que la persona aún no ha visto. */
  nuevo?: boolean;
  siguiendo?: boolean;
  // --- Datos para el panel de atención ---
  prioridad?: Prioridad;
  /** Nombre de la persona encargada. Sin valor = sin asignar. */
  asignadoA?: string;
  /** Técnico que tomó o recibió el ticket. */
  tecnicoAsignado?: Persona;
  /** Supervisor que aceptó o revisó la petición. */
  responsable?: Persona;
  /** Fecha y hora prevista de atención. */
  atender?: Date;
  /** Resumen de una línea de la falla. */
  resumen?: string;
  evidencias?: Evidencia[];
}

export interface Persona {
  nombre: string;
  iniciales: string;
  area: string;
  correo?: string;
}

/** Una entrada de la bitácora de seguimiento. */
export interface Entrada {
  autor: string;
  iniciales: string;
  titulo: string;
  texto: string;
  fecha: Date;
  estado?: Estado;
}

export interface Evidencia {
  nombre: string;
  peso: string;
  tipo: string;
  fecha: Date;
  /** URL firmada temporal, disponible cuando el almacenamiento está configurado. */
  url?: string;
}

export interface DetalleIncidencia extends Incidencia {
  reportante: string;
  creada: Date;
  prioridad: Prioridad;
  descripcion: string;
  etiquetas: string[];
  evidencia?: Evidencia;
  responsable?: Persona;
  atencionEstimada?: string;
  planta?: string;
  referencia?: string;
  /** Fecha en que el reporte llegó a cada estado. */
  hitos: Partial<Record<Estado, Date>>;
  /** Bitácora, de la más reciente a la más antigua. */
  historial: Entrada[];
  /** Otras personas que siguen el reporte (sin contarte a ti). */
  seguidores: number;
  siguiendo: boolean;
}

// ---------- Formulario de nuevo reporte ----------
export type CategoriaId = 'infraestructura_fisica' | 'computo_redes' | 'servicios_academicos';

export const CATEGORIAS: { id: CategoriaId; nombre: string; icono: IconName }[] = [
  { id: 'infraestructura_fisica', nombre: 'Infraestructura', icono: 'building' },
  { id: 'computo_redes', nombre: 'Cómputo / Redes', icono: 'monitor' },
  { id: 'servicios_academicos', nombre: 'Servicios académicos', icono: 'tablet' },
];

export const SEDES = [
  'Administración', 'Auditorio', 'Biblioteca', 'Cafetería', 'Centro de atención',
  'Edificio A', 'Edificio B', 'Edificio C', 'Edificio D', 'Estacionamiento', 'Servicios escolares',
];

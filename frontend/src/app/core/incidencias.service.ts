import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { DetalleIncidencia, Estado, Incidencia, Persona, Prioridad } from './models';
import { SesionService } from './sesion.service';

const API_URL = 'http://localhost:3000/api/incidencias';
const API_ROOT = 'http://localhost:3000/api';

interface ApiSeguimiento {
  fecha: string;
  autor: string;
  estado: string;
  comentario: string;
}

interface ApiIncidencia {
  codigo: string;
  titulo: string;
  descripcion: string;
  categoria: string;
  prioridad: string;
  estado: string;
  reportante: { nombre: string; correo?: string };
  ubicacion: { edificio: string; aula?: string };
  detalle_especifico: Record<string, unknown>;
  tags: string[];
  historial_seguimiento: ApiSeguimiento[];
  evidencias: {
    nombre_original: string;
    tipo: string;
    tamano_bytes: number;
    fecha_carga: string;
    storage_path?: string;
    url?: string;
  }[];
  horas_invertidas: number;
  fecha_creacion: string;
  fecha_cierre?: string;
  responsable_atencion?: { nombre: string; correo: string };
  tecnico_asignado?: { nombre: string; correo: string };
  asignado_a?: { nombre: string; correo: string };
}

interface ApiListResponse {
  total: number;
  data: ApiIncidencia[];
}

interface ApiSingleResponse {
  codigo: string;
  data: ApiIncidencia;
}

interface ApiComentariosResponse {
  data: { autor: { nombre: string }; comentario: string; fecha: string }[];
}

interface ApiSeguimientosResponse {
  data: string[];
}

interface ApiConteoSeguidores {
  total: number;
  siguiendo: boolean;
}

interface ApiEvidenciasResponse {
  data: ApiIncidencia['evidencias'];
}

interface ApiEvidenciaResponse {
  data: ApiIncidencia['evidencias'][number];
}

const ESTADO_DESDE_API: Record<string, Estado> = {
  abierta: 'Recibido',
  en_espera: 'Asignado',
  en_proceso: 'En atención',
  resuelta: 'Resuelto',
  cerrada: 'Resuelto',
};

const ESTADO_A_API: Record<Estado, string> = {
  Recibido: 'abierta',
  Asignado: 'en_espera',
  'En atención': 'en_proceso',
  Resuelto: 'resuelta',
};

const CATEGORIA_LABEL: Record<string, string> = {
  computo_redes: 'Cómputo / Redes',
  infraestructura_fisica: 'Infraestructura',
  servicios_academicos: 'Servicios académicos',
};

const PRIORIDAD_LABEL: Record<string, Prioridad> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

const fecha = (valor: string | Date | undefined): Date =>
  valor ? new Date(valor) : new Date();

const iniciales = (nombre: string): string =>
  nombre.split(/\s+/).map((parte) => parte[0] ?? '').slice(0, 2).join('').toUpperCase();

const fechaActualizacion = (incidencia: ApiIncidencia): Date =>
  fecha(incidencia.historial_seguimiento.at(-1)?.fecha ?? incidencia.fecha_creacion);

@Injectable({ providedIn: 'root' })
export class IncidenciasService {
  private readonly http = inject(HttpClient);
  private readonly sesion = inject(SesionService);
  private readonly documentos = new Map<string, ApiIncidencia>();
  private readonly comentarios = new Map<string, ApiComentariosResponse['data']>();
  private readonly conteoSeguidores = new Map<string, number>();
  private readonly seguidos = new Set<string>();
  private readonly version = signal(0);
  private cargada = false;
  private cargaEnCurso?: Promise<void>;
  private identidadCargada?: string;

  readonly revision = this.version.asReadonly();
  readonly cargando = signal(false);
  readonly error = signal('');

  readonly listas: Record<'mios' | 'siguiendo' | 'todas', Incidencia[]> = {
    mios: [],
    siguiendo: [],
    todas: [],
  };

  async cargar(force = false): Promise<void> {
    const identidad = this.sesion.correo();
    if (!identidad) {
      this.limpiarCache();
      this.identidadCargada = undefined;
      this.cargada = false;
      return;
    }
    if (this.identidadCargada !== identidad) {
      this.limpiarCache();
      this.identidadCargada = identidad;
      this.cargada = false;
      this.cargaEnCurso = undefined;
    }
    if (this.cargaEnCurso) {
      await this.cargaEnCurso;
      if (force) return this.cargar(true);
      return;
    }
    if (this.cargada && !force) return;

    this.cargando.set(true);
    this.error.set('');
    const carga = Promise.all([
      firstValueFrom(this.http.get<ApiListResponse>(API_URL)),
      firstValueFrom(this.http.get<ApiSeguimientosResponse>(`${API_ROOT}/seguimientos`)),
      firstValueFrom(this.http.get<ApiListResponse>(`${API_ROOT}/mis-reportes`)),
    ])
      .then(([{ data }, seguidos, mios]) => {
        if (this.sesion.correo() !== identidad) return;
        this.documentos.clear();
        for (const documento of data) this.documentos.set(documento.codigo, documento);
        this.seguidos.clear();
        for (const codigo of seguidos.data) this.seguidos.add(codigo);
        const incidencias = data.map((documento) => this.adaptar(documento));
        this.reemplazar(this.listas.todas, incidencias);
        this.reemplazar(this.listas.mios, mios.data.map((documento) => this.adaptar(documento)));
        this.reemplazar(this.listas.siguiendo, incidencias.filter((i) => this.seguidos.has(i.folio)));
        this.cargada = true;
        this.version.update((actual) => actual + 1);
      })
      .catch((error: unknown) => {
        if (this.sesion.correo() === identidad) this.error.set(this.mensajeError(error));
        throw error;
      })
      .finally(() => {
        if (this.cargaEnCurso === carga) {
          this.cargando.set(false);
          this.cargaEnCurso = undefined;
        }
      });
    this.cargaEnCurso = carga;

    return carga;
  }

  detalle(folio: string): DetalleIncidencia | undefined {
    this.version();
    const documento = this.documentos.get(folio);
    if (!documento) return undefined;

    const incidencia = this.adaptar(documento);
    const evidencias = documento.evidencias ?? [];
    const hitos: Partial<Record<Estado, Date>> = {};
    for (const entrada of documento.historial_seguimiento) {
      const estado = ESTADO_DESDE_API[entrada.estado];
      if (estado) hitos[estado] = fecha(entrada.fecha);
    }

    const asignado = documento.responsable_atencion ?? documento.asignado_a;
    const responsable: Persona | undefined = asignado
      ? {
          nombre: asignado.nombre,
          iniciales: iniciales(asignado.nombre),
          area: 'Supervisión',
          correo: asignado.correo,
        }
      : undefined;
    const tecnicoAsignado: Persona | undefined = documento.tecnico_asignado
      ? {
          nombre: documento.tecnico_asignado.nombre,
          iniciales: iniciales(documento.tecnico_asignado.nombre),
          area: 'Soporte técnico',
          correo: documento.tecnico_asignado.correo,
        }
      : undefined;

    return {
      ...incidencia,
      reportante: documento.reportante.nombre,
      creada: fecha(documento.fecha_creacion),
      prioridad: PRIORIDAD_LABEL[documento.prioridad] ?? 'Media',
      descripcion: documento.descripcion,
      etiquetas: documento.tags ?? [],
      evidencia: evidencias[0]
        ? {
            nombre: evidencias[0].nombre_original,
            peso: `${Math.max(1, Math.round(evidencias[0].tamano_bytes / 1024))} KB`,
            tipo: evidencias[0].tipo,
            fecha: fecha(evidencias[0].fecha_carga),
            url: evidencias[0].url,
          }
        : undefined,
      evidencias: evidencias.map((evidencia) => ({
        nombre: evidencia.nombre_original,
        peso: `${Math.max(1, Math.round(evidencia.tamano_bytes / 1024))} KB`,
        tipo: evidencia.tipo,
        fecha: fecha(evidencia.fecha_carga),
        url: evidencia.url,
      })),
      responsable,
      tecnicoAsignado,
      atencionEstimada: incidencia.estado === 'Resuelto' ? 'Completada' : 'Por definir',
      planta: documento.ubicacion.aula,
      hitos,
      historial: [
        ...documento.historial_seguimiento.map((entrada) => {
          const estado = ESTADO_DESDE_API[entrada.estado];
          return {
            autor: entrada.autor,
            iniciales: iniciales(entrada.autor),
            titulo: `${entrada.autor} actualizó el reporte`,
            texto: entrada.comentario,
            fecha: fecha(entrada.fecha),
            ...(estado ? { estado } : {}),
          };
        }),
        ...(this.comentarios.get(folio) ?? []).map((comentario) => ({
          autor: comentario.autor.nombre,
          iniciales: iniciales(comentario.autor.nombre),
          titulo: `${comentario.autor.nombre} comentó`,
          texto: comentario.comentario,
          fecha: fecha(comentario.fecha),
        })),
      ].sort((a, b) => b.fecha.getTime() - a.fecha.getTime()),
      seguidores: this.conteoSeguidores.get(folio) ?? 0,
      siguiendo: this.seguidos.has(folio),
    };
  }

  async crear(datos: {
    titulo: string;
    categoria: string;
    edificio: string;
    area: string;
    descripcion: string;
    etiquetas: string[];
  }): Promise<Incidencia> {
    const detalle_especifico = this.detalleEspecifico(datos.categoria, datos.titulo);
    const respuesta = await firstValueFrom(this.http.post<ApiSingleResponse>(API_URL, {
      titulo: datos.titulo,
      descripcion: datos.descripcion,
      categoria: datos.categoria,
      prioridad: 'media',
      ubicacion: { edificio: datos.edificio, aula: datos.area },
      detalle_especifico,
      tags: datos.etiquetas,
      reportante: {
        nombre: this.sesion.usuario.nombre,
        correo: this.sesion.correo(),
        tipo: this.sesion.rol() === 'reportante' ? 'estudiante' : 'administrativo',
      },
    }));

    this.documentos.set(respuesta.codigo, respuesta.data);
    await this.cargar(true);
    return this.adaptar(respuesta.data);
  }

  async registrarAvance(folio: string, cambio: { estado: Estado; texto: string }): Promise<void> {
    const actual = this.documentos.get(folio);
    if (!actual) throw new Error(`No se encontró el reporte ${folio}.`);

    const respuesta = await firstValueFrom(
      this.http.patch<ApiSingleResponse>(`${API_URL}/${encodeURIComponent(folio)}/estado`, {
        estado: ESTADO_A_API[cambio.estado],
        comentario: cambio.texto.trim() || `Estado actualizado a ${cambio.estado}.`,
        horas_invertidas: 0,
        autor: { nombre: this.sesion.usuario.nombre, correo: this.sesion.correo() },
      }),
    );
    this.documentos.set(folio, respuesta.data);
    await this.cargar(true);
  }

  async asignarResponsable(folio: string, usuarioId: string): Promise<void> {
    await firstValueFrom(this.http.patch(
      `${API_URL}/${encodeURIComponent(folio)}/responsable`,
      { usuarioId },
    ));
    await this.cargar(true);
  }

  async asignarTecnico(folio: string, usuarioId: string): Promise<void> {
    await firstValueFrom(this.http.patch(
      `${API_URL}/${encodeURIComponent(folio)}/tecnico`,
      { usuarioId },
    ));
    await this.cargar(true);
  }

  async comentar(folio: string, texto: string): Promise<void> {
    await firstValueFrom(this.http.post(
      `${API_URL}/${encodeURIComponent(folio)}/comentarios`,
      { comentario: texto },
    ));
    await this.cargarComentarios(folio);
  }

  async cargarComentarios(folio: string): Promise<void> {
    const response = await firstValueFrom(this.http.get<ApiComentariosResponse>(
      `${API_URL}/${encodeURIComponent(folio)}/comentarios`,
    ));
    this.comentarios.set(folio, response.data);
    this.version.update((actual) => actual + 1);
  }

  async cargarSeguidores(folio: string): Promise<void> {
    const response = await firstValueFrom(this.http.get<ApiConteoSeguidores>(
      `${API_URL}/${encodeURIComponent(folio)}/seguidores`,
    ));
    if (response.siguiendo) this.seguidos.add(folio);
    else this.seguidos.delete(folio);
    this.conteoSeguidores.set(folio, response.total);
    this.version.update((actual) => actual + 1);
  }

  async alternarSeguimiento(folio: string): Promise<void> {
    const siguiendo = this.seguidos.has(folio);
    const url = `${API_ROOT}/seguimientos/${encodeURIComponent(folio)}`;
    if (siguiendo) {
      await firstValueFrom(this.http.delete(url));
      this.seguidos.delete(folio);
    } else {
      await firstValueFrom(this.http.post(url, {}));
      this.seguidos.add(folio);
    }
    const actualizadas = this.listas.todas.map((incidencia) => ({
      ...incidencia,
      siguiendo: this.seguidos.has(incidencia.folio),
    }));
    this.reemplazar(this.listas.todas, actualizadas);
    this.reemplazar(
      this.listas.mios,
      actualizadas.filter((incidencia) =>
        this.listas.mios.some((reporte) => reporte.folio === incidencia.folio),
      ),
    );
    this.reemplazar(this.listas.siguiendo, actualizadas.filter((incidencia) => this.seguidos.has(incidencia.folio)));
    this.version.update((actual) => actual + 1);
  }

  async subirEvidencia(folio: string, archivo: File): Promise<void> {
    const url = `${API_URL}/${encodeURIComponent(folio)}/evidencias?nombre=${encodeURIComponent(archivo.name)}`;
    const response = await firstValueFrom(this.http.post<ApiEvidenciaResponse>(
      url,
      archivo,
      { headers: { 'Content-Type': archivo.type } },
    ));
    const documento = this.documentos.get(folio);
    if (documento) {
      documento.evidencias ??= [];
      documento.evidencias.push(response.data);
      this.version.update((actual) => actual + 1);
    }
  }

  async cargarEvidencias(folio: string): Promise<void> {
    await this.cargar();
    const response = await firstValueFrom(this.http.get<ApiEvidenciasResponse>(
      `${API_URL}/${encodeURIComponent(folio)}/evidencias`,
    ));
    const documento = this.documentos.get(folio);
    if (documento) {
      documento.evidencias = response.data;
      this.version.update((actual) => actual + 1);
    }
  }

  async reportarModeracion(folio: string): Promise<void> {
    await firstValueFrom(this.http.post(
      `${API_URL}/${encodeURIComponent(folio)}/moderacion`,
      { motivo: 'contenido_inapropiado' },
    ));
  }

  resumen() {
    const activos = this.listas.mios.filter((incidencia) => incidencia.estado !== 'Resuelto');
    const limiteActualizaciones = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const codigosPropiosOSeguidos = new Set([
      ...this.listas.mios.map((incidencia) => incidencia.folio),
      ...this.listas.siguiendo.map((incidencia) => incidencia.folio),
    ]);
    const actualizacionesRecientes = [...codigosPropiosOSeguidos].reduce((total, codigo) => {
      const documento = this.documentos.get(codigo);
      return total + (documento?.historial_seguimiento.filter(
        (entrada) => fecha(entrada.fecha).getTime() >= limiteActualizaciones,
      ).length ?? 0);
    }, 0);
    return {
      total: this.listas.mios.length,
      activos: activos.length,
      recibidos: activos.filter((incidencia) => incidencia.estado === 'Recibido').length,
      enProceso: activos.filter((incidencia) => incidencia.estado !== 'Recibido').length,
      resueltos: this.listas.mios.length - activos.length,
      siguiendo: this.listas.siguiendo.length,
      actualizacionesRecientes,
    };
  }

  resueltosSemana(): number {
    const limite = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return [...this.documentos.values()].filter((documento) =>
      documento.fecha_cierre && fecha(documento.fecha_cierre).getTime() >= limite,
    ).length;
  }

  get resueltosSemanaPasada(): number {
    const ahora = Date.now();
    const inicioSemanaAnterior = ahora - 14 * 24 * 60 * 60 * 1000;
    const finSemanaAnterior = ahora - 7 * 24 * 60 * 60 * 1000;
    return [...this.documentos.values()].filter((documento) => {
      if (!documento.fecha_cierre) return false;
      const cierre = fecha(documento.fecha_cierre).getTime();
      return cierre >= inicioSemanaAnterior && cierre < finSemanaAnterior;
    }).length;
  }

  private adaptar(documento: ApiIncidencia): Incidencia {
    const evidencias = documento.evidencias ?? [];
    return {
      folio: documento.codigo,
      titulo: documento.titulo,
      categoria: CATEGORIA_LABEL[documento.categoria] ?? documento.categoria,
      edificio: documento.ubicacion.edificio,
      area: documento.ubicacion.aula ?? '',
      estado: ESTADO_DESDE_API[documento.estado] ?? 'Recibido',
      actualizada: fechaActualizacion(documento),
      siguiendo: this.seguidos.has(documento.codigo),
      prioridad: PRIORIDAD_LABEL[documento.prioridad] ?? 'Media',
      asignadoA: documento.tecnico_asignado?.nombre,
      tecnicoAsignado: documento.tecnico_asignado
        ? {
            nombre: documento.tecnico_asignado.nombre,
            iniciales: iniciales(documento.tecnico_asignado.nombre),
            area: 'Soporte técnico',
            correo: documento.tecnico_asignado.correo,
          }
        : undefined,
      responsable: (documento.responsable_atencion ?? documento.asignado_a)
        ? {
            nombre: (documento.responsable_atencion ?? documento.asignado_a)!.nombre,
            iniciales: iniciales((documento.responsable_atencion ?? documento.asignado_a)!.nombre),
            area: 'Supervisión',
            correo: (documento.responsable_atencion ?? documento.asignado_a)!.correo,
          }
        : undefined,
      resumen: documento.descripcion.slice(0, 120),
      detalle: documento.historial_seguimiento.at(-1)?.comentario,
    };
  }

  private detalleEspecifico(categoria: string, titulo: string): Record<string, unknown> {
    if (categoria === 'infraestructura_fisica') {
      return {
        tipo_dano: titulo,
        nivel_deterioro: 'moderado',
        riesgo_seguridad: 'medio',
        requiere_contratista: false,
      };
    }
    if (categoria === 'servicios_academicos') {
      return {
        plataforma: titulo,
        codigo_curso: 'No especificado',
        periodo_escolar: 'No especificado',
        estudiantes_impactados: 1,
      };
    }
    return {
      tipo_equipo: titulo,
      ip: 'No especificada',
      vlan: 1,
      puerto_uplink: 'No especificado',
      equipos_afectados: 1,
    };
  }

  private reemplazar<T>(destino: T[], origen: T[]): void {
    destino.splice(0, destino.length, ...origen);
  }

  private limpiarCache(): void {
    this.documentos.clear();
    this.comentarios.clear();
    this.conteoSeguidores.clear();
    this.seguidos.clear();
    this.reemplazar(this.listas.mios, []);
    this.reemplazar(this.listas.siguiendo, []);
    this.reemplazar(this.listas.todas, []);
    this.error.set('');
    this.version.update((actual) => actual + 1);
  }

  private mensajeError(error: unknown): string {
    if (typeof error === 'object' && error !== null && 'error' in error) {
      const mensaje = (error as { error?: { error?: string; message?: string } }).error;
      if (mensaje?.error) return mensaje.error;
      if (mensaje?.message) return mensaje.message;
    }
    return 'No se pudo conectar con la API. Comprueba que el backend esté ejecutándose.';
  }
}

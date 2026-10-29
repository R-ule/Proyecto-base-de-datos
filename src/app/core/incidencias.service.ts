import { Injectable, inject, signal } from '@angular/core';
import { DetalleIncidencia, ESTADOS, Entrada, Estado, Incidencia, Persona } from './models';
import { SesionService } from './sesion.service';

const hace = (minutos: number) => new Date(Date.now() - minutos * 60_000);

/** Fecha futura: dentro de `dias` días, a la `hora` en punto. */
const para = (dias: number, hora: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(hora, 0, 0, 0);
  return d;
};

const inc = (
  n: number, titulo: string, categoria: string, edificio: string, area: string,
  estado: Estado, minutos: number, extra: Partial<Incidencia> = {},
): Incidencia => ({
  folio: `NX-${n}`, titulo, categoria, edificio, area, estado, actualizada: hace(minutos), ...extra,
});

const iniciales = (nombre: string) =>
  nombre.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase();

const YO = 'Ana Martínez';

const PERSONAL: Record<string, Persona> = {
  'Luis Herrera': { nombre: 'Luis Herrera', iniciales: 'LH', area: 'Soporte técnico' },
  'Marta Ríos': { nombre: 'Marta Ríos', iniciales: 'MR', area: 'Mantenimiento' },
  'Jorge Salas': { nombre: 'Jorge Salas', iniciales: 'JS', area: 'Infraestructura' },
};

const personaDe = (nombre: string): Persona =>
  PERSONAL[nombre] ?? { nombre, iniciales: iniciales(nombre), area: 'Soporte técnico' };

/** Datos de ejemplo. Se reemplaza por llamadas a la API (Node + MongoDB Atlas). */
@Injectable({ providedIn: 'root' })
export class IncidenciasService {
  private readonly sesion = inject(SesionService);

  private readonly mios: Incidencia[] = [
    inc(1048, 'Terminal de pagos sin conexión', 'Terminales', 'Centro de atención', 'Módulo 3', 'En atención', 25,
      { prioridad: 'Alta', asignadoA: 'Luis Herrera', atender: para(0, 16), resumen: 'No permite realizar cobros; muestra «Sin conexión».' }),
    inc(1047, 'Proyector no enciende', 'Equipo electrónico', 'Biblioteca', 'Sala 2', 'Recibido', 90,
      { prioridad: 'Media', atender: para(1, 12), resumen: 'El indicador de encendido permanece apagado.' }),
    inc(1043, 'Luminaria intermitente en acceso norte', 'Infraestructura', 'Edificio A', 'Acceso norte', 'Asignado', 1700,
      { prioridad: 'Media', asignadoA: 'Marta Ríos', atender: para(1, 16), resumen: 'La luz parpadea y deja el pasillo a oscuras.' }),
    inc(1036, 'Fuga de agua en sanitarios', 'Infraestructura', 'Edificio B', 'Planta baja', 'Resuelto', 1800),
    inc(1031, 'Puerta del laboratorio no cierra', 'Infraestructura', 'Edificio C', 'Laboratorio 2', 'Resuelto', 4300),
    inc(1029, 'Wi-Fi inestable en aulas', 'Redes', 'Edificio D', 'Aula 105', 'Resuelto', 5800),
    inc(1024, 'Impresora sin tóner', 'Equipo electrónico', 'Administración', 'Oficina 4', 'Resuelto', 8600),
    inc(1019, 'Aire acondicionado ruidoso', 'Infraestructura', 'Biblioteca', 'Sala 1', 'Resuelto', 11500),
    inc(1014, 'Cuenta de plataforma bloqueada', 'Sistemas académicos', 'Servicios escolares', 'Ventanilla 2', 'Resuelto', 14400),
    inc(1009, 'Silla rota en auditorio', 'Mobiliario', 'Auditorio', 'Fila 3', 'Resuelto', 20200),
    inc(1005, 'Cámara de seguridad apagada', 'Seguridad', 'Estacionamiento', 'Entrada', 'Resuelto', 28800),
    inc(1002, 'Contacto eléctrico flojo', 'Infraestructura', 'Edificio A', 'Aula 201', 'Resuelto', 40300),
  ];

  private readonly siguiendo: Incidencia[] = [
    inc(1041, 'PC de consulta se reinicia', 'Equipo electrónico', 'Biblioteca', 'Consulta digital', 'En atención', 300,
      { detalle: 'Diagnóstico en curso', nuevo: true, prioridad: 'Media', asignadoA: 'Luis Herrera', atender: para(1, 17), resumen: 'El equipo se reinicia al abrir el navegador.' }),
    inc(1051, 'Escalón roto en acceso principal', 'Infraestructura', 'Edificio C', 'Entrada', 'Recibido', 45,
      { detalle: 'Reporte recibido', nuevo: true, prioridad: 'Alta', atender: para(0, 14), resumen: 'Borde desprendido; riesgo de caída para visitantes.' }),
    inc(1038, 'Goteo en techo de pasillo', 'Infraestructura', 'Edificio B', 'Pasillo 2', 'Asignado', 2900,
      { detalle: 'Técnico asignado', prioridad: 'Media', asignadoA: 'Marta Ríos', atender: para(2, 10), resumen: 'Hay goteo constante sobre el pasillo.' }),
    inc(1033, 'Sin señal de red en cafetería', 'Redes', 'Cafetería', 'Caja', 'Resuelto', 7200, { detalle: 'Resuelto' }),
    inc(1027, 'Lámpara fundida en estacionamiento', 'Infraestructura', 'Estacionamiento', 'Zona B', 'Resuelto', 9900, { detalle: 'Resuelto' }),
  ];

  private readonly otras: Incidencia[] = [
    inc(1050, 'Puerta atascada en aula magna', 'Infraestructura', 'Edificio D', 'Aula magna', 'Resuelto', 120),
    inc(1049, 'Cable expuesto en sala de espera', 'Infraestructura', 'Centro de atención', 'Sala de espera', 'Asignado', 200,
      { prioridad: 'Alta', asignadoA: 'Marta Ríos', atender: para(0, 15), resumen: 'El recubrimiento está dañado junto a las sillas.' }),
    inc(1045, 'Mal olor en sanitarios', 'Infraestructura', 'Edificio C', 'Planta alta', 'Asignado', 1900,
      { prioridad: 'Media', asignadoA: 'Jorge Salas', atender: para(2, 15), resumen: 'El olor persiste aun después de la limpieza.' }),
    inc(1040, 'Teclado sin respuesta en laboratorio', 'Equipo electrónico', 'Edificio D', 'Laboratorio 1', 'Resuelto', 3500),
    inc(1035, 'Bancas dañadas en el patio', 'Mobiliario', 'Patio central', 'Zona sur', 'Resuelto', 6100),
    inc(1022, 'Portal de calificaciones lento', 'Sistemas académicos', 'Servicios escolares', 'En línea', 'Resuelto', 12700),
  ];

  readonly listas: Record<'mios' | 'siguiendo' | 'todas', Incidencia[]> = {
    mios: this.mios,
    siguiendo: this.siguiendo,
    todas: [...this.mios, ...this.siguiendo, ...this.otras].sort(
      (a, b) => b.actualizada.getTime() - a.actualizada.getTime(),
    ),
  };

  // ---------- Estado de la simulación ----------

  /** Sube cada vez que algo cambia, para que pantallas con signals se actualicen. */
  private readonly version = signal(0);
  readonly revision = this.version.asReadonly();

  private readonly comentarios = signal<Record<string, Entrada[]>>({});
  private readonly seguimientos = signal<Record<string, boolean>>({});
  private readonly hitosMap = new Map<string, Partial<Record<Estado, Date>>>();
  private readonly creadas = new Map<string, Date>();
  private readonly extras = new Map<string, Partial<DetalleIncidencia>>();
  private resueltosAhora = 0;
  private siguiente = 1052;

  // ---------- Detalle de un reporte ----------

  /** Datos completos que solo tiene el reporte NX-1048 (el resto se genera a partir de su estado). */
  private readonly especiales: Record<string, Partial<DetalleIncidencia>> = {
    'NX-1048': {
      creada: hace(69),
      prioridad: 'Alta',
      planta: 'Planta baja',
      referencia: 'Área de cajas, junto a recepción.',
      descripcion:
        'La terminal de pagos del módulo 3 no tiene conexión y no permite realizar cobros. Aparece el mensaje «Sin conexión» desde las 9:00 de hoy. Se reinició el equipo, pero el problema continúa. Las personas están siendo dirigidas al módulo 2.',
      etiquetas: ['conectividad', 'pagos', 'atención al público'],
      evidencia: { nombre: 'terminal-modulo-3.jpg', peso: '1.8 MB', tipo: 'JPG', fecha: hace(69) },
      atencionEstimada: 'Hoy, antes de las 16:00',
      seguidores: 11,
      siguiendo: true,
      hitos: { Recibido: hace(69), Asignado: hace(44), 'En atención': hace(25) },
      historial: [
        { autor: 'Luis Herrera', iniciales: 'LH', titulo: 'Luis Herrera inició la atención', texto: 'Se detectó una falla en el enlace de red. Estamos revisando el punto de conexión del módulo 3.', fecha: hace(25), estado: 'En atención' },
        { autor: 'Soporte técnico', iniciales: 'ST', titulo: 'Soporte técnico recibió la asignación', texto: 'Responsable: Luis Herrera · Prioridad alta por afectación al servicio de pagos.', fecha: hace(44) },
        { autor: YO, iniciales: 'AM', titulo: 'Ana Martínez creó el reporte', texto: 'Reporte recibido con una fotografía de evidencia.', fecha: hace(69) },
      ],
    },
  };

  detalle(folio: string): DetalleIncidencia | undefined {
    this.version();
    const i = this.listas.todas.find((x) => x.folio === folio);
    if (!i) return undefined;
    const base = this.construirDetalle(i);
    const propios = this.comentarios()[folio] ?? [];
    return {
      ...base,
      historial: [...propios, ...base.historial],
      siguiendo: this.seguimientos()[folio] ?? base.siguiendo,
    };
  }

  comentar(folio: string, texto: string): void {
    const autor = this.sesion.usuario;
    this.agregarEntrada(folio, {
      autor: autor.nombre, iniciales: autor.iniciales,
      titulo: `${autor.nombre} agregó un comentario`, texto, fecha: new Date(),
    });
  }

  alternarSeguimiento(folio: string): void {
    const actual = this.detalle(folio)?.siguiendo ?? false;
    this.seguimientos.update((s) => ({ ...s, [folio]: !actual }));
  }

  private agregarEntrada(folio: string, entrada: Entrada): void {
    this.comentarios.update((c) => ({ ...c, [folio]: [entrada, ...(c[folio] ?? [])] }));
  }

  private construirDetalle(i: Incidencia): DetalleIncidencia {
    const idx = ESTADOS.indexOf(i.estado);
    const esMio = this.mios.some((m) => m.folio === i.folio);
    const reportante = esMio ? YO : 'Persona de la comunidad';
    const span = [0, 180, 300, 2880][idx] * 60_000;

    let creada = this.creadas.get(i.folio);
    if (!creada) {
      creada = new Date(i.actualizada.getTime() - span);
      this.creadas.set(i.folio, creada);
    }

    const hitos: Partial<Record<Estado, Date>> = {};
    ESTADOS.slice(0, idx + 1).forEach((e, k) => {
      hitos[e] = new Date(creada.getTime() + (idx ? (span * k) / idx : 0));
    });

    const responsable = i.asignadoA
      ? personaDe(i.asignadoA)
      : idx >= 1 ? personaDe('Luis Herrera') : undefined;

    const base: DetalleIncidencia = {
      ...i,
      reportante,
      creada,
      prioridad: i.prioridad ?? 'Media',
      descripcion: `Se reportó una falla en ${i.edificio} (${i.area}): ${i.titulo.toLowerCase()}.`,
      etiquetas: [i.categoria.toLowerCase()],
      atencionEstimada: idx === 3 ? 'Completada' : idx === 0 ? 'Por definir' : 'En las próximas 24 horas',
      responsable,
      seguidores: 3,
      siguiendo: this.siguiendo.some((s) => s.folio === i.folio),
      hitos,
      historial: this.historialDe(idx, hitos, reportante, responsable?.nombre ?? 'Luis Herrera'),
    };

    const combinado = { ...base, ...(this.especiales[i.folio] ?? {}), ...(this.extras.get(i.folio) ?? {}) };
    const hitosGuardados = this.hitosMap.get(i.folio);
    return hitosGuardados ? { ...combinado, hitos: hitosGuardados } : combinado;
  }

  private historialDe(
    idx: number, hitos: Partial<Record<Estado, Date>>, reportante: string, responsable: string,
  ): Entrada[] {
    const plantillas: Omit<Entrada, 'fecha'>[] = [
      { autor: reportante, iniciales: iniciales(reportante), titulo: `${reportante} creó el reporte`, texto: 'Reporte recibido.' },
      { autor: 'Soporte técnico', iniciales: 'ST', titulo: 'Soporte técnico recibió la asignación', texto: `Responsable: ${responsable} · Prioridad media.` },
      { autor: responsable, iniciales: iniciales(responsable), titulo: `${responsable} inició la atención`, texto: 'Estamos revisando el reporte.', estado: 'En atención' },
      { autor: responsable, iniciales: iniciales(responsable), titulo: `${responsable} marcó el reporte como resuelto`, texto: 'Revisa la solución y confirma si todo quedó bien.', estado: 'Resuelto' },
    ];
    return plantillas
      .slice(0, idx + 1)
      .map((p, k) => ({ ...p, fecha: hitos[ESTADOS[k]] as Date }))
      .reverse();
  }

  // ---------- Panel de atención ----------

  /** Cuántos tickets se resolvieron esta semana (cifra de ejemplo + los que resuelves en la sesión). */
  resueltosSemana(): number {
    this.version();
    return 14 + this.resueltosAhora;
  }

  readonly resueltosSemanaPasada = 10;

  /** Registra un avance del encargado: cambia el estado (si aplica) y agrega una entrada a la bitácora. */
  registrarAvance(folio: string, cambio: { estado: Estado; texto: string }): void {
    const i = this.listas.todas.find((x) => x.folio === folio);
    if (!i) return;

    const autor = this.sesion.usuario;
    const antes = i.estado;
    const cambioEstado = cambio.estado !== antes;

    if (cambioEstado) {
      // Se guardan los hitos actuales antes de cambiar el estado para no perder las fechas.
      const hitos = { ...(this.detalle(folio)?.hitos ?? {}) };
      const nuevo = ESTADOS.indexOf(cambio.estado);
      ESTADOS.forEach((e, k) => {
        if (k > nuevo) delete hitos[e];
        else if (!hitos[e]) hitos[e] = new Date();
      });
      this.hitosMap.set(folio, hitos);

      i.estado = cambio.estado;
      if (cambio.estado === 'Resuelto') this.resueltosAhora++;
      else if (antes === 'Resuelto') this.resueltosAhora = Math.max(0, this.resueltosAhora - 1);
      if (cambio.estado !== 'Recibido' && !i.asignadoA) i.asignadoA = autor.nombre;
    }

    i.actualizada = new Date();
    this.agregarEntrada(folio, {
      autor: autor.nombre,
      iniciales: autor.iniciales,
      titulo: cambioEstado ? `${autor.nombre} cambió el estado a ${cambio.estado}` : `${autor.nombre} agregó un avance`,
      texto: cambio.texto || 'Actualización de estado.',
      fecha: new Date(),
      estado: cambioEstado ? cambio.estado : undefined,
    });

    this.listas.mios.sort((a, b) => b.actualizada.getTime() - a.actualizada.getTime());
    this.listas.todas.sort((a, b) => b.actualizada.getTime() - a.actualizada.getTime());
    this.version.update((v) => v + 1);
  }

  // ---------- Altas y resumen ----------

  /** Simula el POST a la API: agrega el reporte nuevo a "Mis reportes". */
  crear(datos: {
    titulo: string; categoria: string; edificio: string; area: string;
    descripcion?: string; etiquetas?: string[];
  }): Incidencia {
    const nueva = inc(this.siguiente++, datos.titulo, datos.categoria, datos.edificio, datos.area, 'Recibido', 0, {
      prioridad: 'Media',
      atender: para(1, 12),
      resumen: datos.descripcion?.slice(0, 90),
    });
    this.mios.unshift(nueva);
    this.listas.todas.unshift(nueva);
    this.creadas.set(nueva.folio, nueva.actualizada);

    const extra: Partial<DetalleIncidencia> = {};
    if (datos.descripcion) extra.descripcion = datos.descripcion;
    if (datos.etiquetas?.length) extra.etiquetas = datos.etiquetas;
    this.extras.set(nueva.folio, extra);

    this.version.update((v) => v + 1);
    return nueva;
  }

  resumen() {
    const activos = this.mios.filter((i) => i.estado !== 'Resuelto');
    return {
      total: this.mios.length,
      activos: activos.length,
      recibidos: activos.filter((i) => i.estado === 'Recibido').length,
      enProceso: activos.filter((i) => i.estado !== 'Recibido').length,
      resueltos: this.mios.length - activos.length,
      siguiendo: this.siguiendo.length,
      nuevas: this.siguiendo.filter((i) => i.nuevo).length,
    };
  }
}

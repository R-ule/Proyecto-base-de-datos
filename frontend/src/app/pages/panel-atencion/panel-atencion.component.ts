import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { formatearActualizacion, formatearAtencion } from '../../core/format';
import { IconComponent } from '../../core/icon.component';
import { IncidenciasService } from '../../core/incidencias.service';
import { ESTADOS, ESTADO_CLASE, Estado, Incidencia, PRIORIDADES, PRIORIDAD_CLASE, Prioridad } from '../../core/models';
import { SesionService } from '../../core/sesion.service';

type Pestana = 'pendientes' | 'mios' | 'resueltos';

const POR_PAGINA = 6;
const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
const pesoPrioridad = (p?: Prioridad) => PRIORIDADES.indexOf(p ?? 'Media');
const esHoy = (d: Date) => d.toDateString() === new Date().toDateString();
const horaCorta = (d: Date) => d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false });
const API_ADMIN = 'http://localhost:3000/api/admin';

interface UsuarioAsignable {
  id: string;
  nombre: string;
  correo: string;
  rol: 'reportante' | 'tecnico' | 'administrador' | 'auditor' | 'superAdmin';
  activo: boolean;
}

@Component({
  selector: 'app-panel-atencion',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './panel-atencion.component.html',
  styleUrl: './panel-atencion.component.scss',
})
export class PanelAtencionComponent {
  private readonly datos = inject(IncidenciasService);
  private readonly http = inject(HttpClient);
  private readonly sesion = inject(SesionService);
  readonly yo = this.sesion.usuario;
  readonly esSupervisor = this.sesion.rol() === 'administrador';
  readonly esTecnico = this.sesion.rol() === 'encargado';
  readonly supervisores = signal<UsuarioAsignable[]>([]);
  readonly tecnicos = signal<UsuarioAsignable[]>([]);
  readonly errorAsignacion = signal('');
  readonly avisoAsignacion = signal('');
  readonly asignando = signal(false);

  readonly estados = ESTADOS;
  readonly prioridades = PRIORIDADES;
  readonly claseEstado = ESTADO_CLASE;
  readonly clasePrioridad = PRIORIDAD_CLASE;
  readonly hora = formatearActualizacion;
  readonly atencion = formatearAtencion;

  // ---------- Datos ----------
  /** Copias para que los signals detecten los cambios que hace el servicio. */
  private readonly todos = computed<Incidencia[]>(() => {
    this.datos.revision();
    return this.datos.listas.todas.map((t) => ({ ...t }));
  });

  readonly pendientes = computed(() => this.todos().filter((t) => t.estado !== 'Resuelto'));
  readonly mios = computed(() => this.pendientes().filter((t) => t.tecnicoAsignado?.correo === this.yo.correo));
  readonly resueltos = computed(() => this.todos().filter((t) => t.estado === 'Resuelto'));

  readonly resumen = computed(() => {
    const p = this.pendientes();
    const semana = this.datos.resueltosSemana();
    return {
      pendientes: p.length,
      sinAsignar: p.filter((t) => !t.tecnicoAsignado).length,
      alta: p.filter((t) => t.prioridad === 'Alta' || t.prioridad === 'Crítica').length,
      enAtencion: this.mios().filter((t) => t.estado === 'En atención').length,
      semana,
      diferencia: semana - this.datos.resueltosSemanaPasada,
    };
  });

  /** Tickets de prioridad alta con atención prevista para hoy. */
  readonly urgentes = computed(() =>
    this.pendientes().filter(
      (t) => (t.prioridad === 'Alta' || t.prioridad === 'Crítica') && t.atender && esHoy(t.atender),
    ),
  );

  readonly horaLimite = computed(() => {
    const horas = this.urgentes().map((t) => (t.atender as Date).getTime());
    return horas.length ? horaCorta(new Date(Math.min(...horas))) : '';
  });

  // ---------- Filtros y lista ----------
  readonly pestana = signal<Pestana>('pendientes');
  readonly busqueda = signal('');
  readonly prioridad = signal<Prioridad | ''>('');
  readonly responsable = signal('');
  readonly pagina = signal(1);

  private readonly base = computed(() => ({
    pendientes: this.pendientes(),
    mios: this.mios(),
    resueltos: this.resueltos(),
  })[this.pestana()]);

  readonly responsables = computed(() => [
    ...new Set(
      this.pendientes()
        .map((t) => t.tecnicoAsignado?.nombre)
        .filter((n): n is string => !!n),
    ),
  ].sort());

  readonly hayFiltros = computed(() => !!(this.busqueda() || this.prioridad() || this.responsable()));

  readonly filtradas = computed(() => {
    const q = normalizar(this.busqueda());
    const r = this.responsable();
    const lista = this.base().filter(
      (t) =>
        (!this.prioridad() || t.prioridad === this.prioridad()) &&
        (!r || (r === 'sin' ? !t.tecnicoAsignado
          : r === 'yo' ? t.tecnicoAsignado?.correo === this.yo.correo
            : t.tecnicoAsignado?.nombre === r)) &&
        (!q || normalizar(`${t.titulo} ${t.folio} ${t.resumen ?? ''}`).includes(q)),
    );
    // Pendientes: primero la mayor prioridad y, a igual prioridad, la atención más próxima.
    return this.pestana() === 'resueltos'
      ? lista.sort((a, b) => b.actualizada.getTime() - a.actualizada.getTime())
      : lista.sort(
          (a, b) =>
            pesoPrioridad(a.prioridad) - pesoPrioridad(b.prioridad) ||
            (a.atender?.getTime() ?? Infinity) - (b.atender?.getTime() ?? Infinity),
        );
  });

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));
  readonly paginaActual = computed(() => Math.min(this.pagina(), this.totalPaginas()));
  readonly visibles = computed(() => {
    const desde = (this.paginaActual() - 1) * POR_PAGINA;
    return this.filtradas().slice(desde, desde + POR_PAGINA);
  });

  readonly etiquetaLista = computed(
    () => ({ pendientes: 'pendientes del equipo', mios: 'tickets tuyos', resueltos: 'tickets resueltos' })[this.pestana()],
  );

  // ---------- Ticket seleccionado ----------
  private readonly seleccionado = signal<string | null>(null);

  readonly ticket = computed(
    () => this.filtradas().find((t) => t.folio === this.seleccionado()) ?? this.visibles()[0] ?? null,
  );

  readonly detalle = computed(() => {
    const t = this.ticket();
    return t ? this.datos.detalle(t.folio) : undefined;
  });

  // ---------- Formulario de avance ----------
  readonly form = new FormGroup({
    estado: new FormControl<Estado>('Recibido', { nonNullable: true }),
    avance: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
  });

  readonly error = signal('');
  readonly aviso = signal('');
  readonly adjuntos = signal<File[]>([]);
  readonly actualizado = signal(new Date());
  readonly actualizando = signal(false);

  constructor() {
    if (this.esSupervisor) void this.cargarUsuariosAsignables();
    // Al cambiar de ticket, el formulario se reinicia con el estado actual de ese ticket.
    effect(() => {
      const t = this.ticket();
      untracked(() => {
        this.form.reset({ estado: t?.estado ?? 'Recibido', avance: '' });
        this.error.set('');
        this.adjuntos.set([]);
      });
    });
  }

  // ---------- Acciones ----------
  cambiarPestana(p: Pestana): void {
    this.pestana.set(p);
    this.pagina.set(1);
  }

  buscar(v: string): void { this.busqueda.set(v); this.pagina.set(1); }
  filtrarPrioridad(v: string): void { this.prioridad.set(v as Prioridad | ''); this.pagina.set(1); }
  filtrarResponsable(v: string): void { this.responsable.set(v); this.pagina.set(1); }

  limpiarFiltros(): void {
    this.busqueda.set('');
    this.prioridad.set('');
    this.responsable.set('');
    this.pagina.set(1);
  }

  verPrioritarios(): void {
    this.pestana.set('pendientes');
    this.responsable.set('');
    this.busqueda.set('');
    this.prioridad.set('Alta');
    this.pagina.set(1);
  }

  irA(p: number): void {
    if (p >= 1 && p <= this.totalPaginas()) this.pagina.set(p);
  }

  seleccionar(folio: string): void {
    this.seleccionado.set(folio);
  }

  vencida(t: Incidencia): boolean {
    return !!t.atender && t.estado !== 'Resuelto' && t.atender.getTime() < Date.now();
  }

  esHoy(d: Date): boolean {
    return esHoy(d);
  }

  responsableTexto(t: Incidencia): string {
    return t.responsable?.nombre ?? 'Sin asignar';
  }

  idResponsable(t: Incidencia): string {
    return this.supervisores().find((usuario) => usuario.correo === t.responsable?.correo)?.id ?? '';
  }

  idTecnico(t: Incidencia): string {
    return this.tecnicos().find((usuario) => usuario.correo === t.tecnicoAsignado?.correo)?.id ?? '';
  }

  async cambiarResponsable(folio: string, usuarioId: string): Promise<void> {
    if (!usuarioId) return;
    this.errorAsignacion.set('');
    try {
      await this.datos.asignarResponsable(folio, usuarioId);
      this.avisoAsignacion.set(`${folio}: responsable actualizado.`);
    } catch (error) {
      this.errorAsignacion.set(this.mensajeError(error));
    }
  }

  async cambiarTecnico(folio: string, usuarioId: string): Promise<void> {
    if (!usuarioId) return;
    this.errorAsignacion.set('');
    try {
      await this.datos.asignarTecnico(folio, usuarioId);
      this.avisoAsignacion.set(`${folio}: técnico asignado.`);
    } catch (error) {
      this.errorAsignacion.set(this.mensajeError(error));
    }
  }

  async tomarTicket(t: Incidencia): Promise<void> {
    if (!this.esTecnico || t.tecnicoAsignado) return;
    this.errorAsignacion.set('');
    this.asignando.set(true);
    try {
      await this.datos.asignarTecnico(t.folio, this.yo.id);
      this.avisoAsignacion.set(`${t.folio}: ahora está asignado a ti.`);
    } catch (error) {
      this.errorAsignacion.set(this.mensajeError(error));
    } finally {
      this.asignando.set(false);
    }
  }

  get puedeGuardar(): boolean {
    const t = this.ticket();
    const { estado, avance } = this.form.getRawValue();
    const asignadoAOtro = this.esTecnico && !!t?.tecnicoAsignado &&
      t.tecnicoAsignado.correo !== this.yo.correo;
    return !!t && !asignadoAOtro && this.form.valid &&
      (estado !== t.estado || avance.trim().length > 0 || this.adjuntos().length > 0);
  }

  adjuntar(lista: FileList | null): void {
    const archivos = lista ? Array.from(lista) : [];
    const validos = archivos.filter((archivo) =>
      ['image/jpeg', 'image/png', 'application/pdf'].includes(archivo.type) &&
      archivo.size <= 10 * 1024 * 1024,
    );
    if (validos.length !== archivos.length) this.error.set('Solo se aceptan JPG, PNG o PDF de hasta 10 MB.');
    else this.error.set('');
    if (validos.length > 5) this.error.set('Solo puedes seleccionar hasta cinco archivos por vez.');
    this.adjuntos.set(validos.slice(0, 5));
  }

  async guardar(): Promise<void> {
    const t = this.ticket();
    if (!t || !this.puedeGuardar) return;

    const { estado, avance } = this.form.getRawValue();
    const texto = avance.trim();
    const archivos = [...this.adjuntos()];
    const cambioEstado = estado !== t.estado || texto.length > 0;
    if (cambioEstado && estado === 'Resuelto' && t.estado !== 'Resuelto' && !texto) {
      this.error.set('Describe la solución antes de marcar el ticket como resuelto.');
      return;
    }

    this.error.set('');
    this.actualizando.set(true);
    try {
      if (cambioEstado) await this.datos.registrarAvance(t.folio, { estado, texto });
      const fallidos: File[] = [];
      for (const archivo of archivos) {
        try {
          await this.datos.subirEvidencia(t.folio, archivo);
        } catch (error) {
          fallidos.push(archivo);
          this.error.set(`${archivo.name}: ${error instanceof Error ? error.message : 'no se pudo subir.'}`);
        }
      }
      this.adjuntos.set(fallidos);
      if (!fallidos.length) this.mostrarAviso(`${t.folio} actualizado${cambioEstado ? ` · ${estado}` : ' · archivos adjuntos'}`);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo actualizar el reporte.');
    } finally {
      this.actualizando.set(false);
    }
  }

  async actualizar(): Promise<void> {
    this.actualizando.set(true);
    this.error.set('');
    try {
      await this.datos.cargar(true);
      this.actualizado.set(new Date());
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo actualizar la lista.');
    } finally {
      this.actualizando.set(false);
    }
  }

  private mostrarAviso(texto: string): void {
    this.aviso.set(texto);
    setTimeout(() => this.aviso.set(''), 4000);
  }

  horaActualizado(): string {
    return horaCorta(this.actualizado());
  }

  private async cargarUsuariosAsignables(): Promise<void> {
    try {
      const { data } = await firstValueFrom(this.http.get<{ data: UsuarioAsignable[] }>(`${API_ADMIN}/users`));
      this.supervisores.set(data.filter((usuario) =>
        usuario.activo && (usuario.rol === 'administrador' || usuario.rol === 'superAdmin'),
      ));
      this.tecnicos.set(data.filter((usuario) => usuario.activo && usuario.rol === 'tecnico'));
    } catch (error) {
      this.errorAsignacion.set(this.mensajeError(error));
    }
  }

  private mensajeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { error?: string } | null;
      if (body?.error) return body.error;
      if (error.status === 0) return 'No se pudo conectar con la API.';
    }
    return error instanceof Error ? error.message : 'No se pudo actualizar la asignación.';
  }
}

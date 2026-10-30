import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { IconComponent, IconName } from '../../core/icon.component';

const API_URL = 'http://localhost:3000/api/admin';

interface AdminSummary {
  total: number;
  abiertos: number;
  cerrados: number;
  prioridadAlta: number;
  resueltosMes: number;
  pendientesRevision: number;
  porEstado: { _id: string; total: number }[];
  porCategoria: { _id: string; total: number }[];
  promedioPorEdificio: { _id: string; promedio_horas: number }[];
  etiquetasFrecuentes: { _id: string; total: number }[];
  usuarios: { total: number; activos: number; porRol: { _id: string; total: number }[] };
}

interface AdminUser {
  id: string;
  nombre: string;
  correo: string;
  rol: 'reportante' | 'tecnico' | 'administrador' | 'superAdmin';
  activo: boolean;
}

interface Moderacion {
  _id: string;
  codigo: string;
  motivo: string;
  comentario: string;
  estado: string;
  reportado_por: { nombre: string; correo: string };
  fecha_creacion: string;
}

const etiquetaRol = (rol: AdminUser['rol']): string =>
  rol === 'tecnico' ? 'Encargado' : rol === 'superAdmin' ? 'Superadministrador' : rol === 'administrador' ? 'Administrador' : 'Reportante';

const apiRol = (etiqueta: string): 'reportante' | 'tecnico' | 'administrador' =>
  etiqueta === 'Encargado' ? 'tecnico' : etiqueta === 'Administrador' ? 'administrador' : 'reportante';

const etiquetaCategoria = (categoria: string): string => ({
  computo_redes: 'Cómputo / Redes',
  infraestructura_fisica: 'Infraestructura',
  servicios_academicos: 'Servicios académicos',
}[categoria] ?? categoria);

@Component({
  selector: 'app-administracion',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, IconComponent, BaseChartDirective],
  templateUrl: './administracion.component.html',
  styleUrl: './administracion.component.scss',
})
export class AdministracionComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly resumen = signal<AdminSummary | null>(null);
  readonly usuarios = signal<AdminUser[]>([]);
  readonly moderaciones = signal<Moderacion[]>([]);
  readonly cargando = signal(false);
  readonly mostrarFormulario = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly perfiles = ['Reportante', 'Encargado', 'Administrador'];
  readonly motivos: string[] = ['contenido_inapropiado', 'informacion_personal', 'duplicado', 'otro'];

  readonly formulario = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    correo: ['', [Validators.required, Validators.email]],
    rol: ['reportante', Validators.required],
    password: ['', [Validators.required, Validators.minLength(12), Validators.maxLength(128)]],
  });

  readonly estadisticas = computed(() => {
    const data = this.resumen();
    return [
      { titulo: 'Reportes activos', valor: String(data?.abiertos ?? '—'), subtitulo: `${data?.total ?? 0} reportes en total`, icono: 'copy' as IconName },
      { titulo: 'Prioridad alta', valor: String(data?.prioridadAlta ?? '—'), subtitulo: 'Incidencias altas o críticas abiertas', icono: 'flag' as IconName },
      { titulo: 'Resueltos este mes', valor: String(data?.resueltosMes ?? '—'), subtitulo: `${data?.cerrados ?? 0} resueltos o cerrados`, icono: 'check-circle' as IconName },
      { titulo: 'Usuarios activos', valor: String(data?.usuarios.activos ?? '—'), subtitulo: `${data?.usuarios.total ?? 0} cuentas registradas`, icono: 'users' as IconName },
    ];
  });

  readonly panorama = computed(() => {
    const categories = this.resumen()?.porCategoria ?? [];
    const max = Math.max(1, ...categories.map((item) => item.total));
    return categories.map((item) => ({
      categoria: etiquetaCategoria(item._id),
      valor: item.total,
      ancho: item.total / max * 100,
    }));
  });

  readonly barChartOptions: ChartOptions<'bar'> = { responsive: true, maintainAspectRatio: false };
  readonly pieChartOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' } },
  };
  barChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  pieChartData: ChartConfiguration<'pie'>['data'] = { labels: [], datasets: [] };

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [summary, users, queue] = await Promise.all([
        firstValueFrom(this.http.get<AdminSummary>(`${API_URL}/summary`)),
        firstValueFrom(this.http.get<{ data: AdminUser[] }>(`${API_URL}/users`)),
        firstValueFrom(this.http.get<{ data: Moderacion[] }>(`${API_URL}/moderation`)),
      ]);
      this.resumen.set(summary);
      this.usuarios.set(users.data);
      this.moderaciones.set(queue.data);
      this.actualizarGraficas(summary);
    } catch (error) {
      this.error.set(this.mensajeError(error));
    } finally {
      this.cargando.set(false);
    }
  }

  async cambiarPerfil(usuario: AdminUser, etiqueta: string): Promise<void> {
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(`${API_URL}/users/${encodeURIComponent(usuario.id)}/role`, {
        rol: apiRol(etiqueta),
      }));
      this.aviso.set(`Perfil de ${usuario.nombre} actualizado.`);
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensajeError(error));
      await this.cargar();
    }
  }

  async crearUsuario(): Promise<void> {
    if (this.formulario.invalid) {
      this.formulario.markAllAsTouched();
      return;
    }
    this.error.set('');
    try {
      await firstValueFrom(this.http.post(`${API_URL}/users`, this.formulario.getRawValue()));
      this.formulario.reset({ nombre: '', correo: '', rol: 'reportante', password: '' });
      this.mostrarFormulario.set(false);
      this.aviso.set('Usuario creado correctamente.');
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensajeError(error));
    }
  }

  async resolver(reporte: Moderacion, decision: 'cerrado' | 'ocultar'): Promise<void> {
    this.error.set('');
    try {
      await firstValueFrom(this.http.patch(
        `${API_URL}/moderation/${encodeURIComponent(reporte._id)}`,
        { decision },
      ));
      this.aviso.set(`${reporte.codigo}: revisión registrada.`);
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensajeError(error));
    }
  }

  exportar(): void {
    const summary = this.resumen();
    if (!summary) return;
    const filas = [
      ['Indicador', 'Valor'],
      ['Reportes totales', String(summary.total)],
      ['Reportes activos', String(summary.abiertos)],
      ['Cerrados', String(summary.cerrados)],
      ['Prioridad alta', String(summary.prioridadAlta)],
      ['Resueltos este mes', String(summary.resueltosMes)],
      ['Usuarios activos', String(summary.usuarios.activos)],
      ...summary.porCategoria.map((item) => [etiquetaCategoria(item._id), String(item.total)]),
    ];
    const csv = '\ufeff' + filas.map((fila) => fila.map((celda) => `"${celda.replace(/"/g, '""')}"`).join(',')).join('\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = 'resumen-incidencias.csv';
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  rolVisible(usuario: AdminUser): string {
    return etiquetaRol(usuario.rol);
  }

  iniciales(nombre: string): string {
    return nombre.split(/\s+/).slice(0, 2).map((parte) => parte[0] ?? '').join('').toUpperCase();
  }

  private actualizarGraficas(data: AdminSummary): void {
    this.barChartData = {
      labels: data.promedioPorEdificio.map((item) => item._id || 'Sin edificio'),
      datasets: [{
        data: data.promedioPorEdificio.map((item) => Math.round(item.promedio_horas * 10) / 10),
        label: 'Horas promedio hasta cierre',
        backgroundColor: '#0f766e',
        borderRadius: 4,
      }],
    };
    const colores = ['#0f766e', '#14b8a6', '#0ea5e9', '#f59e0b', '#ef4444'];
    this.pieChartData = {
      labels: data.etiquetasFrecuentes.map((item) => item._id),
      datasets: [{
        data: data.etiquetasFrecuentes.map((item) => item.total),
        backgroundColor: colores,
      }],
    };
  }

  private mensajeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const body = error.error as { error?: string } | null;
      if (body?.error) return body.error;
      if (error.status === 0) return 'No se pudo conectar con la API.';
    }
    return error instanceof Error ? error.message : 'No se pudo completar la operación.';
  }
}

import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BaseChartDirective } from 'ng2-charts';
import { ChartConfiguration, ChartOptions } from 'chart.js';
import { firstValueFrom } from 'rxjs';
import { IconComponent } from '../../core/icon.component';

const API_URL = 'http://localhost:3000/api/moderacion';

interface Moderacion {
  _id: string;
  codigo: string;
  motivo: string;
  comentario: string;
  estado: string;
  reportado_por: { nombre: string; correo: string };
  fecha_creacion: string;
}

interface ModeracionSummary {
  promedioPorEdificio: { _id: string; promedio_horas: number }[];
  etiquetasFrecuentes: { _id: string; total: number }[];
  reportesActivos: number;
  pendientesRevision: number;
}

@Component({
  selector: 'app-moderacion',
  standalone: true,
  imports: [CommonModule, RouterLink, IconComponent, BaseChartDirective],
  templateUrl: './moderacion.component.html',
  styleUrl: './moderacion.component.scss',
})
export class ModeracionComponent {
  private readonly http = inject(HttpClient);
  readonly moderaciones = signal<Moderacion[]>([]);
  readonly cargando = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly resolviendo = signal<string[]>([]);

  readonly barChartOptions: ChartOptions<'bar'> = { responsive: true, maintainAspectRatio: false };
  readonly pieChartOptions: ChartOptions<'pie'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'right' } },
  };
  readonly conteosChartOptions: ChartOptions<'bar'> = {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: { legend: { display: false } },
    scales: { x: { beginAtZero: true, ticks: { precision: 0 } } },
  };
  barChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };
  pieChartData: ChartConfiguration<'pie'>['data'] = { labels: [], datasets: [] };
  conteosChartData: ChartConfiguration<'bar'>['data'] = { labels: [], datasets: [] };

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [summary, queue] = await Promise.all([
        firstValueFrom(this.http.get<ModeracionSummary>(`${API_URL}/summary`)),
        firstValueFrom(this.http.get<{ data: Moderacion[] }>(API_URL)),
      ]);
      this.moderaciones.set(queue.data);
      this.actualizarGraficas(summary);
    } catch (error) {
      this.error.set(this.mensajeError(error));
    } finally {
      this.cargando.set(false);
    }
  }

  async resolver(reporte: Moderacion, decision: 'cerrado' | 'ocultar'): Promise<void> {
    this.error.set('');
    this.resolviendo.update((ids) => [...ids, reporte._id]);
    try {
      await firstValueFrom(this.http.patch(
        `${API_URL}/${encodeURIComponent(reporte._id)}`,
        { decision },
      ));
      this.aviso.set(`${reporte.codigo}: revisión registrada.`);
      await this.cargar();
    } catch (error) {
      this.error.set(this.mensajeError(error));
    } finally {
      this.resolviendo.update((ids) => ids.filter((id) => id !== reporte._id));
    }
  }

  exportar(): void {
    const filas = [
      ['Folio', 'Motivo', 'Comentario', 'Reportado por', 'Correo', 'Fecha', 'Estado'],
      ...this.moderaciones().map((reporte) => [
        reporte.codigo,
        reporte.motivo,
        reporte.comentario,
        reporte.reportado_por.nombre,
        reporte.reportado_por.correo,
        new Date(reporte.fecha_creacion).toLocaleString(),
        reporte.estado,
      ]),
    ];
    const csv = '\ufeff' + filas
      .map((fila) => fila.map((celda) => {
        const safeCell = /^[\t\r\n ]*[=+\-@]/.test(celda) ? `'${celda}` : celda;
        return `"${safeCell.replace(/"/g, '""')}"`;
      }).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = 'cola-moderacion.csv';
    enlace.click();
    URL.revokeObjectURL(url);
  }

  estaResolviendo(id: string): boolean {
    return this.resolviendo().includes(id);
  }

  private actualizarGraficas(data: ModeracionSummary): void {
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
    this.conteosChartData = {
      labels: ['Reportes activos', 'Pendientes de revisión'],
      datasets: [{
        data: [data.reportesActivos, data.pendientesRevision],
        backgroundColor: ['#0f766e', '#f59e0b'],
        borderRadius: 4,
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

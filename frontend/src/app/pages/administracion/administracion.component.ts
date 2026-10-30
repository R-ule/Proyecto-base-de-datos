import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { IconComponent, IconName } from '../../core/icon.component';
import { EMAIL_PATTERN } from '../../core/validation';

const API_URL = 'http://localhost:3000/api/admin';

interface AdminSummary {
  total: number;
  abiertos: number;
  cerrados: number;
  prioridadAlta: number;
  resueltosMes: number;
  porCategoria: { _id: string; total: number }[];
  usuarios: { total: number; activos: number; porRol: { _id: string; total: number }[] };
}

interface AdminUser {
  id: string;
  nombre: string;
  correo: string;
  rol: 'reportante' | 'tecnico' | 'administrador' | 'auditor' | 'superAdmin';
  activo: boolean;
}

const etiquetaRol = (rol: AdminUser['rol']): string =>
  rol === 'tecnico' ? 'Encargado' : rol === 'superAdmin' ? 'Superadministrador'
    : rol === 'administrador' ? 'Administrador' : rol === 'auditor' ? 'Auditor' : 'Reportante';

const apiRol = (etiqueta: string): 'reportante' | 'tecnico' | 'administrador' | 'auditor' =>
  etiqueta === 'Encargado' ? 'tecnico' : etiqueta === 'Administrador' ? 'administrador'
    : etiqueta === 'Auditor' ? 'auditor' : 'reportante';

const etiquetaCategoria = (categoria: string): string => ({
  computo_redes: 'Cómputo / Redes',
  infraestructura_fisica: 'Infraestructura',
  servicios_academicos: 'Servicios académicos',
}[categoria] ?? categoria);

@Component({
  selector: 'app-administracion',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, IconComponent],
  templateUrl: './administracion.component.html',
  styleUrl: './administracion.component.scss',
})
export class AdministracionComponent {
  private readonly http = inject(HttpClient);
  private readonly fb = inject(FormBuilder);
  readonly resumen = signal<AdminSummary | null>(null);
  readonly usuarios = signal<AdminUser[]>([]);
  readonly cargando = signal(false);
  readonly mostrarFormulario = signal(false);
  readonly error = signal('');
  readonly aviso = signal('');
  readonly perfiles = ['Reportante', 'Encargado', 'Administrador', 'Auditor'];

  readonly formulario = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    correo: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    rol: ['reportante', Validators.required],
    password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(8)]],
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

  constructor() {
    void this.cargar();
  }

  async cargar(): Promise<void> {
    this.cargando.set(true);
    this.error.set('');
    try {
      const [summary, users] = await Promise.all([
        firstValueFrom(this.http.get<AdminSummary>(`${API_URL}/summary`)),
        firstValueFrom(this.http.get<{ data: AdminUser[] }>(`${API_URL}/users`)),
      ]);
      this.resumen.set(summary);
      this.usuarios.set(users.data);
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

  rolVisible(usuario: AdminUser): string {
    return etiquetaRol(usuario.rol);
  }

  iniciales(nombre: string): string {
    return nombre.split(/\s+/).slice(0, 2).map((parte) => parte[0] ?? '').join('').toUpperCase();
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

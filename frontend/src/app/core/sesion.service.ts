import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

export type Rol = 'reportante' | 'encargado' | 'administrador';
type ApiRol = Rol | 'tecnico' | 'superAdmin';

interface ApiUsuario {
  id: string;
  nombre: string;
  correo: string;
  rol: ApiRol;
  activo: boolean;
}

interface SesionResponse {
  token?: string;
  usuario: ApiUsuario;
}

export interface Usuario {
  id: string;
  nombre: string;
  primerNombre: string;
  iniciales: string;
  correo: string;
  area: string;
  rol: string;
  perfil: string;
}

const API_URL = 'http://localhost:3000/api/auth';
const TOKEN_KEY = 'nexo:token';
const USUARIO_KEY = 'nexo:usuario';

const rolDesdeApi = (rol: ApiRol): Rol =>
  rol === 'tecnico' ? 'encargado' : rol === 'superAdmin' ? 'administrador' : rol;

const usuarioDesdeApi = (usuario: ApiUsuario): Usuario => {
  const rol = rolDesdeApi(usuario.rol);
  const primerNombre = usuario.nombre.trim().split(/\s+/)[0] ?? usuario.nombre;
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    primerNombre,
    iniciales: usuario.nombre.trim().split(/\s+/).slice(0, 2).map((parte) => parte[0] ?? '').join('').toUpperCase(),
    correo: usuario.correo,
    area: rol === 'encargado' ? 'Soporte técnico' : rol === 'administrador' ? 'Administración' : 'Comunidad universitaria',
    rol: rol === 'encargado' ? 'Encargado' : rol === 'administrador' ? 'Administrador' : 'Reportante',
    perfil: rol === 'encargado' ? 'Consulta y atención de fallas'
      : rol === 'administrador' ? 'Acceso de administración'
        : 'Crea y sigue tus reportes',
  };
};

const tokenGuardado = (): string | null =>
  localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY);

@Injectable({ providedIn: 'root' })
export class SesionService {
  private readonly http = inject(HttpClient);
  private readonly usuarioApi = signal<ApiUsuario | null>(this.leerUsuario());

  readonly rol = computed<Rol>(() => this.usuarioApi() ? rolDesdeApi(this.usuarioApi()!.rol) : 'reportante');
  readonly correo = computed(() => this.usuarioApi()?.correo ?? '');
  readonly actual = computed(() => {
    const user = this.usuarioApi();
    return user ? usuarioDesdeApi(user) : {
      id: '',
      nombre: '',
      primerNombre: '',
      iniciales: '',
      correo: '',
      area: '',
      rol: '',
      perfil: '',
    };
  });
  readonly autenticado = computed(() => Boolean(tokenGuardado() && this.usuarioApi()));
  readonly error = signal('');

  constructor() {
    if (tokenGuardado()) void this.restaurar();
  }

  get usuario(): Usuario {
    return this.actual();
  }

  async iniciarSesion(correo: string, password: string, recordar: boolean): Promise<Rol> {
    this.error.set('');
    try {
      const respuesta = await firstValueFrom(this.http.post<SesionResponse>(`${API_URL}/login`, {
        correo: correo.trim().toLowerCase(),
        password,
      }));
      if (!respuesta.token) throw new Error('La API no devolvió un token de sesión.');
      this.guardar(respuesta.token, respuesta.usuario, recordar);
      return this.rol();
    } catch (error) {
      const mensaje = this.mensajeError(error);
      this.error.set(mensaje);
      throw new Error(mensaje);
    }
  }

  cerrarSesion(): void {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USUARIO_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USUARIO_KEY);
    this.usuarioApi.set(null);
  }

  rutaInicial(rol: Rol = this.rol()): string {
    return rol === 'administrador' ? '/administracion' : rol === 'encargado' ? '/panel-atencion' : '/inicio';
  }

  private async restaurar(): Promise<void> {
    try {
      const respuesta = await firstValueFrom(this.http.get<SesionResponse>(`${API_URL}/me`));
      this.guardar(tokenGuardado()!, respuesta.usuario, Boolean(localStorage.getItem(TOKEN_KEY)));
    } catch (error) {
      if (error instanceof HttpErrorResponse && error.status === 401) this.cerrarSesion();
      else this.error.set(this.mensajeError(error));
    }
  }

  private guardar(token: string, usuario: ApiUsuario, recordar: boolean): void {
    this.cerrarSesion();
    const destino = recordar ? localStorage : sessionStorage;
    destino.setItem(TOKEN_KEY, token);
    destino.setItem(USUARIO_KEY, JSON.stringify(usuario));
    this.usuarioApi.set(usuario);
  }

  private leerUsuario(): ApiUsuario | null {
    try {
      const raw = localStorage.getItem(USUARIO_KEY) ?? sessionStorage.getItem(USUARIO_KEY);
      if (!raw) return null;
      const value: unknown = JSON.parse(raw);
      if (typeof value !== 'object' || value === null ||
          !('id' in value) || typeof value.id !== 'string' ||
          !('nombre' in value) || typeof value.nombre !== 'string' ||
          !('correo' in value) || typeof value.correo !== 'string' ||
          !('rol' in value) || typeof value.rol !== 'string' ||
          !('activo' in value) || typeof value.activo !== 'boolean') return null;
      const role = value.rol as ApiRol;
      if (!['reportante', 'encargado', 'administrador', 'tecnico', 'superAdmin'].includes(role)) return null;
      return { id: value.id, nombre: value.nombre, correo: value.correo, rol: role, activo: value.activo };
    } catch {
      return null;
    }
  }

  private mensajeError(error: unknown): string {
    if (error instanceof HttpErrorResponse) {
      const apiError = error.error as { error?: string } | null;
      if (apiError?.error) return apiError.error;
      if (error.status === 0) return 'No se pudo conectar con el servidor de autenticación.';
    }
    return error instanceof Error ? error.message : 'No se pudo iniciar sesión.';
  }
}

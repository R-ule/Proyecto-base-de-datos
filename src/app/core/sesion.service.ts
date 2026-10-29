import { Injectable, computed, signal } from '@angular/core';

export type Rol = 'reportante' | 'encargado' | 'administrador';

export interface Usuario {
  nombre: string;
  primerNombre: string;
  iniciales: string;
  area: string;
  /** Etiqueta del perfil, se muestra en la barra superior. */
  rol: string;
  /** Frase corta del recuadro "Perfil activo". */
  perfil: string;
}

const USUARIOS: Record<Rol, Usuario> = {
  reportante: {
    nombre: 'Ana Martínez', primerNombre: 'Ana', iniciales: 'AM',
    area: 'Atención ciudadana', rol: 'Reportante', perfil: 'Crea y sigue tus reportes',
  },
  encargado: {
    nombre: 'Luis Herrera', primerNombre: 'Luis', iniciales: 'LH',
    area: 'Soporte técnico', rol: 'Encargado', perfil: 'Consulta y atención de fallas',
  },
  administrador: {
    nombre: 'Sofía Ramírez', primerNombre: 'Sofía', iniciales: 'SR',
    area: 'Administración central', rol: 'Administrador', perfil: 'Acceso completo al sistema',
  },
};

const INICIO: Record<Rol, string> = {
  reportante: '/inicio',
  encargado: '/panel-atencion',
  administrador: '/administracion',
};

/** Sesión simulada. Se reemplaza por la autenticación real (JWT) cuando exista la API. */
@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly rol = signal<Rol>('reportante');
  readonly actual = computed(() => USUARIOS[this.rol()]);
  readonly perfiles = (Object.keys(USUARIOS) as Rol[]).map((r) => ({ id: r, ...USUARIOS[r] }));

  get usuario(): Usuario {
    return this.actual();
  }

  /**
   * Demo: el perfil depende del correo.
   * sofia… / admin… → Administrador · luis… / encargado… / soporte… → Encargado · cualquier otro → Reportante.
   */
  iniciarSesion(correo: string): Rol {
    const c = correo.trim();
    const rol: Rol = /^(sofia|sofía|admin)/i.test(c)
      ? 'administrador'
      : /^(luis|encargad|soporte|tecnic)/i.test(c) ? 'encargado' : 'reportante';
    this.rol.set(rol);
    return rol;
  }

  cambiarRol(rol: Rol): void {
    this.rol.set(rol);
  }

  rutaInicial(rol: Rol = this.rol()): string {
    return INICIO[rol];
  }
}

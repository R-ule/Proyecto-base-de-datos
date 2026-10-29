import { Injectable, computed, signal } from '@angular/core';

export type Rol = 'reportante' | 'encargado';

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
};

/** Sesión simulada. Se reemplaza por la autenticación real (JWT) cuando exista la API. */
@Injectable({ providedIn: 'root' })
export class SesionService {
  readonly rol = signal<Rol>('reportante');
  readonly actual = computed(() => USUARIOS[this.rol()]);
  readonly esEncargado = computed(() => this.rol() === 'encargado');
  readonly perfiles = (Object.keys(USUARIOS) as Rol[]).map((r) => ({ id: r, ...USUARIOS[r] }));

  get usuario(): Usuario {
    return this.actual();
  }

  /** Demo: los correos que empiezan con luis / encargado / soporte / tecnico entran como Encargado. */
  iniciarSesion(correo: string): Rol {
    const rol: Rol = /^(luis|encargad|soporte|tecnic)/i.test(correo.trim()) ? 'encargado' : 'reportante';
    this.rol.set(rol);
    return rol;
  }

  cambiarRol(rol: Rol): void {
    this.rol.set(rol);
  }

  rutaInicial(rol: Rol = this.rol()): string {
    return rol === 'encargado' ? '/panel-atencion' : '/inicio';
  }
}

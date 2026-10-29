import { Component, ElementRef, computed, HostListener, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { IconComponent, IconName } from '../core/icon.component';
import { Rol, SesionService } from '../core/sesion.service';

interface ItemMenu { ruta: string; texto: string; icono: IconName; badge?: number; }

@Component({
  selector: 'app-shell',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  private readonly router = inject(Router);
  readonly sesion = inject(SesionService);
  readonly usuario = this.sesion.actual;

  readonly menu: ItemMenu[] = [
    { ruta: '/inicio', texto: 'Inicio', icono: 'grid' },
    { ruta: '/mis-reportes', texto: 'Mis reportes', icono: 'copy' },
    { ruta: '/siguiendo', texto: 'Siguiendo', icono: 'bookmark' },
    { ruta: '/explorar', texto: 'Explorar reportes', icono: 'search' },
  ];

  /** Sección "Gestión": cambia según el perfil (el reportante no la ve). */
  readonly gestion = computed<ItemMenu[]>(() => {
    const panel: ItemMenu = { ruta: '/panel-atencion', texto: 'Panel de atención', icono: 'wrench' };
    switch (this.sesion.rol()) {
      case 'encargado':
        return [panel];
      case 'administrador':
        return [
          panel,
          { ruta: '/administracion', texto: 'Administración', icono: 'shield' },
          { ruta: '/usuarios', texto: 'Usuarios', icono: 'users' },
          { ruta: '/moderacion', texto: 'Moderación', icono: 'filter', badge: 8 },
        ];
      default:
        return [];
    }
  });

  readonly menuAbierto = signal(false);
  readonly menuPerfil = signal(false);
  private readonly buscador = viewChild<ElementRef<HTMLInputElement>>('buscador');

  /** Nombre de la sección actual para el breadcrumb (viene de `data.label` en las rutas). */
  readonly seccion = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      startWith(null),
      map(() => {
        let r = this.router.routerState.snapshot.root;
        while (r.firstChild) r = r.firstChild;
        return (r.data['label'] as string | undefined) ?? 'Inicio';
      }),
    ),
    { initialValue: 'Inicio' },
  );

  /** Demo: cambia de perfil sin cerrar sesión. */
  elegirPerfil(rol: Rol): void {
    this.menuPerfil.set(false);
    this.menuAbierto.set(false);
    if (rol === this.sesion.rol()) return;
    this.sesion.cambiarRol(rol);
    this.router.navigateByUrl(this.sesion.rutaInicial(rol));
  }

  @HostListener('document:keydown', ['$event'])
  atajos(e: KeyboardEvent): void {
    if (e.key === 'Escape') this.menuPerfil.set(false);
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      this.buscador()?.nativeElement.focus();
    }
  }
}

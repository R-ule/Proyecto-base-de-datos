import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { IconComponent, IconName } from '../core/icon.component';
import { Rol, SesionService } from '../core/sesion.service';

interface ItemMenu { ruta: string; texto: string; icono: IconName; }

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

  /** Solo visible para el perfil Encargado. */
  readonly gestion: ItemMenu[] = [
    { ruta: '/panel-atencion', texto: 'Panel de atención', icono: 'wrench' },
  ];

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

import { Component, ElementRef, computed, HostListener, inject, signal, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map, startWith } from 'rxjs';
import { IconComponent, IconName } from '../core/icon.component';
import { IncidenciasService } from '../core/incidencias.service';
import { SesionService } from '../core/sesion.service';

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
  readonly incidencias = inject(IncidenciasService);
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
          { ruta: '/moderacion', texto: 'Moderación', icono: 'filter' },
        ];
      case 'auditor':
        return [{ ruta: '/moderacion', texto: 'Moderación', icono: 'filter' }];
      default:
        return [];
    }
  });

  readonly menuAbierto = signal(false);
  readonly menuPerfil = signal(false);
  readonly rutasVisitadas = signal<string[]>([]);
  readonly puedeVolver = computed(() => this.rutasVisitadas().length > 1);
  private readonly buscador = viewChild<ElementRef<HTMLInputElement>>('buscador');

  constructor() {
    this.registrarRuta(this.router.url);
    this.router.events
      .pipe(filter((event): event is NavigationEnd => event instanceof NavigationEnd))
      .subscribe((event) => this.registrarRuta(event.urlAfterRedirects));
    void this.incidencias.cargar().catch((error: unknown) =>
      console.error('No se pudieron cargar las incidencias desde la API:', error),
    );
  }

  volver(): void {
    const rutas = this.rutasVisitadas();
    if (rutas.length > 1) {
      const destino = rutas[rutas.length - 2];
      this.rutasVisitadas.set(rutas.slice(0, -1));
      void this.router.navigateByUrl(destino);
      return;
    }
    void this.router.navigateByUrl(this.sesion.rutaInicial());
  }

  private registrarRuta(url: string): void {
    const ruta = url.split(/[?#]/, 1)[0] || '/';
    const rutas = this.rutasVisitadas();
    if (rutas[rutas.length - 1] !== ruta) this.rutasVisitadas.set([...rutas, ruta]);
  }

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

  cerrarSesion(): void {
    this.menuPerfil.set(false);
    this.menuAbierto.set(false);
    this.sesion.cerrarSesion();
    void this.router.navigateByUrl('/login');
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

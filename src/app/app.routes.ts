import { Routes } from '@angular/router';
import { soloEncargado } from './core/guards';

const pendiente = (label: string, descripcion: string, title = `${label} | nexo`) => ({
  path: '',
  title,
  data: { label, descripcion },
  loadComponent: () =>
    import('./pages/placeholder/placeholder.component').then((m) => m.PlaceholderComponent),
});

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'login' },
  {
    path: 'login',
    title: 'Iniciar sesión | Cuida',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    // Todas las pantallas autenticadas comparten sidebar y barra superior.
    path: '',
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      {
        path: 'inicio',
        title: 'Inicio | nexo',
        data: { label: 'Inicio' },
        loadComponent: () => import('./pages/inicio/inicio.component').then((m) => m.InicioComponent),
      },
      {
        path: 'mis-reportes/:folio',
        title: 'Detalle de reporte | nexo',
        data: { label: 'Detalle de reporte' },
        loadComponent: () =>
          import('./pages/detalle-reporte/detalle-reporte.component').then((m) => m.DetalleReporteComponent),
      },
      {
        path: 'levantar-reporte',
        title: 'Nuevo reporte | nexo',
        data: { label: 'Nuevo reporte' },
        loadComponent: () =>
          import('./pages/nuevo-reporte/nuevo-reporte.component').then((m) => m.NuevoReporteComponent),
      },
      {
        path: 'panel-atencion',
        title: 'Panel de atención | nexo',
        data: { label: 'Panel de atención' },
        canActivate: [soloEncargado],
        loadComponent: () =>
          import('./pages/panel-atencion/panel-atencion.component').then((m) => m.PanelAtencionComponent),
      },
      { ...pendiente('Mis reportes', 'Aquí verás todos los reportes que has levantado. Pantalla pendiente de construir.'), path: 'mis-reportes' },
      { ...pendiente('Siguiendo', 'Aquí verás los reportes de otras personas que sigues. Pantalla pendiente de construir.'), path: 'siguiendo' },
      { ...pendiente('Explorar reportes', 'Aquí podrás buscar fallas ya reportadas para seguirlas sin duplicar. Pantalla pendiente de construir.'), path: 'explorar' },
      { ...pendiente('Ayuda y soporte', 'Aquí encontrarás ayuda y datos de contacto. Pantalla pendiente de construir.'), path: 'ayuda' },
    ],
  },
  { path: '**', redirectTo: 'login' },
];

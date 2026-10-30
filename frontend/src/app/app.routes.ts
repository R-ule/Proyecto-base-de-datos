import { Routes } from '@angular/router';
import { requiereSesion, soloRoles } from './core/guards';

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
    canActivate: [requiereSesion],
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
          import('./pages/detalles-reporte/detalle-reporte.component').then((m) => m.DetalleReporteComponent),
      },
      {
        path: 'mis-reportes',
        title: 'Mis reportes | nexo',
        data: { label: 'Mis reportes', modo: 'mios' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
      },
      {
        path: 'siguiendo',
        title: 'Reportes que sigo | nexo',
        data: { label: 'Siguiendo', modo: 'siguiendo' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
      },
      {
        path: 'explorar',
        title: 'Explorar reportes | nexo',
        data: { label: 'Explorar reportes', modo: 'explorar' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
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
        canActivate: [soloRoles('encargado', 'administrador')],
        loadComponent: () =>
          import('./pages/panel-atencion/panel-atencion.component').then((m) => m.PanelAtencionComponent),
      },
      {
        path: 'administracion',
        title: 'Administración | nexo',
        data: { label: 'Administración' },
        canActivate: [soloRoles('administrador')],
        loadComponent: () =>
          import('./pages/administracion/administracion.component').then((m) => m.AdministracionComponent),
      },
      {
        path: 'usuarios',
        title: 'Usuarios | nexo',
        data: { label: 'Usuarios' },
        canActivate: [soloRoles('administrador')],
        loadComponent: () => import('./pages/administracion/administracion.component').then((m) => m.AdministracionComponent),
      },
      {
        path: 'moderacion',
        title: 'Moderación | nexo',
        data: { label: 'Moderación' },
        canActivate: [soloRoles('administrador')],
        loadComponent: () => import('./pages/administracion/administracion.component').then((m) => m.AdministracionComponent),
      },
      { ...pendiente('Ayuda y soporte', 'Aquí encontrarás ayuda y datos de contacto. Pantalla pendiente de construir.'), path: 'ayuda' },
    ],
  },
  { path: '**', redirectTo: 'login' },
];

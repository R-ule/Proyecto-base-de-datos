import { Routes } from '@angular/router';
import { requiereSesion, soloRoles } from './core/guards';

const pendiente = (label: string, descripcion: string, title = `${label} | UTM-desk`) => ({
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
    title: 'Iniciar sesión | UTM-desk',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'registro',
    title: 'Crear cuenta | UTM-desk',
    loadComponent: () => import('./pages/registro/registro.component').then((m) => m.RegistroComponent),
  },
  {
    // Todas las pantallas autenticadas comparten sidebar y barra superior.
    path: '',
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    canActivate: [requiereSesion],
    children: [
      {
        path: 'inicio',
        title: 'Inicio | UTM-desk',
        data: { label: 'Inicio' },
        loadComponent: () => import('./pages/inicio/inicio.component').then((m) => m.InicioComponent),
      },
      {
        path: 'mis-reportes/:folio',
        title: 'Detalle de reporte | UTM-desk',
        data: { label: 'Detalle de reporte' },
        loadComponent: () =>
          import('./pages/detalles-reporte/detalle-reporte.component').then((m) => m.DetalleReporteComponent),
      },
      {
        path: 'mis-reportes',
        title: 'Mis reportes | UTM-desk',
        data: { label: 'Mis reportes', modo: 'mios' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
      },
      {
        path: 'siguiendo',
        title: 'Reportes que sigo | UTM-desk',
        data: { label: 'Siguiendo', modo: 'siguiendo' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
      },
      {
        path: 'explorar',
        title: 'Explorar reportes | UTM-desk',
        data: { label: 'Explorar reportes', modo: 'explorar' },
        loadComponent: () => import('./pages/incidencias-lista/incidencias-lista.component').then((m) => m.IncidenciasListaComponent),
      },
      {
        path: 'levantar-reporte',
        title: 'Nuevo reporte | UTM-desk',
        data: { label: 'Nuevo reporte' },
        loadComponent: () =>
          import('./pages/nuevo-reporte/nuevo-reporte.component').then((m) => m.NuevoReporteComponent),
      },
      {
        path: 'panel-atencion',
        title: 'Panel de atención | UTM-desk',
        data: { label: 'Panel de atención' },
        canActivate: [soloRoles('encargado', 'administrador')],
        loadComponent: () =>
          import('./pages/panel-atencion/panel-atencion.component').then((m) => m.PanelAtencionComponent),
      },
      {
        path: 'administracion',
        title: 'Administración | UTM-desk',
        data: { label: 'Administración' },
        canActivate: [soloRoles('administrador')],
        loadComponent: () =>
          import('./pages/administracion/administracion.component').then((m) => m.AdministracionComponent),
      },
      {
        path: 'usuarios',
        pathMatch: 'full',
        redirectTo: 'administracion',
      },
      {
        path: 'moderacion',
        title: 'Moderación | UTM-desk',
        data: { label: 'Moderación' },
        canActivate: [soloRoles('administrador', 'auditor')],
        loadComponent: () =>
          import('./pages/moderacion/moderacion.component').then((m) => m.ModeracionComponent),
      },
      { ...pendiente('Ayuda y soporte', 'Aquí encontrarás ayuda y datos de contacto. Pantalla pendiente de construir.'), path: 'ayuda' },
    ],
  },
  { path: '**', redirectTo: 'login' },
];

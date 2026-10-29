import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-administracion',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './administracion.component.html',
  styleUrls: ['./administracion.component.scss']
})
export class AdministracionComponent {
  estadisticas = [
    { titulo: 'Reportes activos', valor: '38', subtitulo: '12 recibidos · 26 en proceso', icono: 'document' },
    { titulo: 'Prioridad alta', valor: '7', subtitulo: '3 con atención prevista hoy', icono: 'flag' },
    { titulo: 'Resueltos este mes', valor: '124', subtitulo: 'Tiempo medio de atención: 1.8 días', icono: 'check' },
    { titulo: 'Usuarios activos', valor: '86', subtitulo: '68 reportantes · 15 encargados · 3 admins', icono: 'users' }
  ];

  panorama = [
    { categoria: 'Infraestructura', valor: 18, porcentaje: '45%' },
    { categoria: 'Equipo electrónico', valor: 12, porcentaje: '30%' },
    { categoria: 'Terminales', valor: 8, porcentaje: '20%' }
  ];

  usuarios = [
    { iniciales: 'AM', nombre: 'Ana Martínez', email: 'ana.martinez@centro.gob.mx', perfil: 'Reportante', estado: 'Activo' },
    { iniciales: 'LH', nombre: 'Luis Herrera', email: 'luis.herrera@centro.gob.mx', perfil: 'Encargado', estado: 'Activo' },
    { iniciales: 'SR', nombre: 'Sofía Ramírez', email: 'sofia.ramirez@centro.gob.mx', perfil: 'Administrador', estado: 'Activo' }
  ];

  revisiones = [
    { id: 'NX-1047', tipo: 'Etiqueta', detectado: '«no jala»', contexto: 'Proyector no enciende', tagRevision: 'Etiqueta poco clara · Sustituir por:', propuesta: 'encendido', accionBtn: 'Aplicar ajuste', btnClass: 'btn-primary' },
    { id: 'NX-1054', tipo: 'Descripción', detectado: '«Eso no sirve, está fatal»', contexto: 'Pendiente de revisión', tagRevision: 'Falta contexto', propuesta: 'Pedir ubicación y una descripción concreta de la falla.', accionBtn: 'Solicitar detalle', btnClass: 'btn-outline' },
    { id: 'NX-1055', tipo: 'Descripción', detectado: '«Vendo celulares, informes aquí»', contexto: 'Pendiente de revisión', tagRevision: 'No corresponde', propuesta: 'Publicidad sin relación con una falla o servicio.', accionBtn: 'Rechazar', btnClass: 'btn-outline' }
  ];
}
import { Component, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent, IconName } from '../../core/icon.component';

type Motivo = 'Etiqueta poco clara' | 'Falta contexto' | 'No corresponde';

interface Revision {
  id: string;
  tipo: string;
  detectado: string;
  contexto: string;
  motivo: Motivo;
  propuesta: string;
  /** La propuesta se puede editar antes de aplicarla. */
  editable?: boolean;
  accion: string;
  icono?: IconName;
  primaria?: boolean;
}

const ESCALA_PANORAMA = 40;
const TOTAL_COLA = 8;

@Component({
  selector: 'app-administracion',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './administracion.component.html',
  styleUrl: './administracion.component.scss',
})
export class AdministracionComponent {
  readonly estadisticas: { titulo: string; valor: string; subtitulo: string; icono: IconName }[] = [
    { titulo: 'Reportes activos', valor: '38', subtitulo: '12 recibidos · 26 en proceso', icono: 'copy' },
    { titulo: 'Prioridad alta', valor: '7', subtitulo: '3 con atención prevista hoy', icono: 'flag' },
    { titulo: 'Resueltos este mes', valor: '124', subtitulo: 'Tiempo medio de atención: 1.8 días', icono: 'check-circle' },
    { titulo: 'Usuarios activos', valor: '86', subtitulo: '68 reportantes · 15 encargados · 3 admins', icono: 'users' },
  ];

  readonly panorama = [
    { categoria: 'Infraestructura', valor: 18 },
    { categoria: 'Equipo electrónico', valor: 12 },
    { categoria: 'Terminales', valor: 8 },
  ].map((p) => ({ ...p, ancho: (p.valor / ESCALA_PANORAMA) * 100 }));

  readonly perfiles = ['Reportante', 'Encargado', 'Administrador'];

  readonly usuarios = signal([
    { iniciales: 'AM', nombre: 'Ana Martínez', email: 'ana.martinez@centro.gob.mx', perfil: 'Reportante', estado: 'Activo' },
    { iniciales: 'LH', nombre: 'Luis Herrera', email: 'luis.herrera@centro.gob.mx', perfil: 'Encargado', estado: 'Activo' },
    { iniciales: 'SR', nombre: 'Sofía Ramírez', email: 'sofia.ramirez@centro.gob.mx', perfil: 'Administrador', estado: 'Activo' },
  ]);

  readonly motivos: Motivo[] = ['Etiqueta poco clara', 'Falta contexto', 'No corresponde'];
  readonly motivo = signal('');
  readonly aviso = signal('');

  private readonly revisiones = signal<Revision[]>([
    { id: 'NX-1047', tipo: 'Etiqueta', detectado: '«no jala»', contexto: 'Proyector no enciende', motivo: 'Etiqueta poco clara', propuesta: 'encendido', editable: true, accion: 'Aplicar ajuste', icono: 'check', primaria: true },
    { id: 'NX-1054', tipo: 'Descripción', detectado: '«Eso no sirve, está fatal»', contexto: 'Pendiente de revisión', motivo: 'Falta contexto', propuesta: 'Pedir ubicación y una descripción concreta de la falla.', accion: 'Solicitar detalle' },
    { id: 'NX-1055', tipo: 'Descripción', detectado: '«Vendo celulares, informes aquí»', contexto: 'Pendiente de revisión', motivo: 'No corresponde', propuesta: 'Publicidad sin relación con una falla o servicio.', accion: 'Rechazar', icono: 'x' },
  ]);

  private readonly resueltas = signal(0);
  readonly porRevisar = computed(() => TOTAL_COLA - this.resueltas());
  readonly visibles = computed(() => this.revisiones().filter((r) => !this.motivo() || r.motivo === this.motivo()));

  cambiarPerfil(email: string, perfil: string): void {
    this.usuarios.update((lista) => lista.map((u) => (u.email === email ? { ...u, perfil } : u)));
  }

  resolver(r: Revision): void {
    this.revisiones.update((lista) => lista.filter((x) => x.id !== r.id));
    this.resueltas.update((n) => n + 1);
    this.avisar(r.editable ? `${r.id}: etiqueta sustituida por «${r.propuesta}»` : `${r.id}: ${r.accion.toLowerCase()} registrado`);
  }

  /** Descarga el resumen como CSV (abre bien en Excel). */
  exportar(): void {
    const filas: string[][] = [
      ['Indicador', 'Valor', 'Detalle'],
      ...this.estadisticas.map((s) => [s.titulo, s.valor, s.subtitulo]),
      ...this.panorama.map((p) => [`Reportes activos · ${p.categoria}`, String(p.valor), '']),
      ['Atendidos dentro del plazo', '92%', ''],
    ];
    const csv = '\ufeff' + filas.map((f) => f.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    enlace.download = 'resumen-nexo.csv';
    enlace.click();
    URL.revokeObjectURL(enlace.href);
  }

  private avisar(texto: string): void {
    this.aviso.set(texto);
    setTimeout(() => this.aviso.set(''), 4000);
  }
}

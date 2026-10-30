import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { formatearActualizacion } from '../../core/format';
import { IconComponent } from '../../core/icon.component';
import { IncidenciasService } from '../../core/incidencias.service';
import { ESTADOS, ESTADO_CLASE, Estado } from '../../core/models';
import { SesionService } from '../../core/sesion.service';

type Pestana = 'mios' | 'siguiendo' | 'todas';
const POR_PAGINA = 4;

const normalizar = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

@Component({
  selector: 'app-inicio',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './inicio.component.html',
  styleUrl: './inicio.component.scss',
})
export class InicioComponent {
  private readonly datos = inject(IncidenciasService);

  private readonly sesion = inject(SesionService);

  get usuario() {
    return this.sesion.usuario;
  }

  readonly listas = this.datos.listas;
  readonly resumen = computed(() => {
    this.datos.revision();
    return this.datos.resumen();
  });
  readonly estados = ESTADOS;
  readonly claseEstado = ESTADO_CLASE;
  readonly fecha = formatearActualizacion;

  readonly hoy = new Date().toLocaleDateString('es-MX', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });

  readonly saludo = (() => {
    const h = new Date().getHours();
    return h < 12 ? 'Buen día' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
  })();

  readonly novedades = computed(() => {
    this.datos.revision();
    return this.listas.mios.slice(0, 2).map((incidencia) => ({
      icono: incidencia.estado === 'Resuelto' ? 'check-circle' as const : 'wrench' as const,
      titulo: incidencia.detalle || 'Reporte recibido',
      detalle: `${incidencia.folio} · ${incidencia.titulo}`,
      cuando: this.fecha(incidencia.actualizada),
    }));
  });

  // ---- Estado de la tabla ----
  readonly pestana = signal<Pestana>('mios');
  readonly busqueda = signal('');
  readonly estado = signal<Estado | ''>('');
  readonly categoria = signal('');
  readonly pagina = signal(1);

  private readonly base = computed(() => {
    this.datos.revision();
    return this.listas[this.pestana()];
  });

  readonly categorias = computed(() => [...new Set(this.base().map((i) => i.categoria))].sort());

  readonly filtradas = computed(() => {
    const q = normalizar(this.busqueda());
    return this.base().filter(
      (i) =>
        (!this.estado() || i.estado === this.estado()) &&
        (!this.categoria() || i.categoria === this.categoria()) &&
        (!q || normalizar(`${i.titulo} ${i.folio}`).includes(q)),
    );
  });

  readonly totalPaginas = computed(() => Math.max(1, Math.ceil(this.filtradas().length / POR_PAGINA)));
  readonly paginas = computed(() => Array.from({ length: this.totalPaginas() }, (_, i) => i + 1));
  readonly visibles = computed(() => {
    const desde = (this.pagina() - 1) * POR_PAGINA;
    return this.filtradas().slice(desde, desde + POR_PAGINA);
  });

  cambiarPestana(p: Pestana): void {
    this.pestana.set(p);
    this.categoria.set('');
    this.pagina.set(1);
  }

  buscar(valor: string): void { this.busqueda.set(valor); this.pagina.set(1); }
  filtrarEstado(valor: string): void { this.estado.set(valor as Estado | ''); this.pagina.set(1); }
  filtrarCategoria(valor: string): void { this.categoria.set(valor); this.pagina.set(1); }

  irA(p: number): void {
    if (p >= 1 && p <= this.totalPaginas()) this.pagina.set(p);
  }
}

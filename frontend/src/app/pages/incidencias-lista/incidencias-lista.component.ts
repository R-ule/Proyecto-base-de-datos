import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { formatearActualizacion } from '../../core/format';
import { IncidenciasService } from '../../core/incidencias.service';
import { Estado } from '../../core/models';

type ModoLista = 'mios' | 'siguiendo' | 'explorar';

const TITULOS: Record<ModoLista, string> = {
  mios: 'Mis reportes',
  siguiendo: 'Reportes que sigo',
  explorar: 'Explorar reportes',
};

const normalizar = (texto: string) =>
  texto.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

@Component({
  selector: 'app-incidencias-lista',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './incidencias-lista.component.html',
  styleUrl: './incidencias-lista.component.scss',
})
export class IncidenciasListaComponent {
  readonly datos = inject(IncidenciasService);
  readonly modo = toSignal(
    inject(ActivatedRoute).data.pipe(map((data) => data['modo'] as ModoLista)),
    { initialValue: 'explorar' as ModoLista },
  );
  readonly titulo = computed(() => TITULOS[this.modo()]);
  readonly busqueda = signal('');
  readonly estado = signal<Estado | ''>('');
  readonly actualizado = formatearActualizacion;

  readonly lista = computed(() => {
    this.datos.revision();
    const all = this.modo() === 'mios' ? this.datos.listas.mios
      : this.modo() === 'siguiendo' ? this.datos.listas.siguiendo
        : this.datos.listas.todas;
    const term = normalizar(this.busqueda().trim());
    return all.filter((item) =>
      (!this.estado() || item.estado === this.estado()) &&
      (!term || normalizar(`${item.folio} ${item.titulo} ${item.categoria} ${item.edificio} ${item.resumen ?? ''}`).includes(term)),
    );
  });

  constructor() {
    void this.datos.cargar().catch((error: unknown) =>
      this.datos.error.set(error instanceof Error ? error.message : 'No se pudieron cargar los reportes.'),
    );
  }

  async alternarSeguimiento(folio: string): Promise<void> {
    this.datos.error.set('');
    try {
      await this.datos.alternarSeguimiento(folio);
    } catch (error) {
      this.datos.error.set(error instanceof Error ? error.message : 'No se pudo actualizar el seguimiento.');
    }
  }
}

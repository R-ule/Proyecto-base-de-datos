import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { map } from 'rxjs';
import { formatearActualizacion, formatearFechaCompleta, formatearHito } from '../../core/format';
import { IconComponent } from '../../core/icon.component';
import { IncidenciasService } from '../../core/incidencias.service';
import { ESTADOS, ESTADO_CLASE } from '../../core/models';

interface Paso {
  nombre: string;
  fecha?: Date;
  pendiente: string;
  estado: 'hecho' | 'actual' | 'pendiente';
}

@Component({
  selector: 'app-detalle-reporte',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './detalle-reporte.component.html',
  styleUrl: './detalle-reporte.component.scss',
})
export class DetalleReporteComponent {
  private readonly datos = inject(IncidenciasService);

  readonly claseEstado = ESTADO_CLASE;
  readonly hora = formatearActualizacion;
  readonly completa = formatearFechaCompleta;
  readonly hito = formatearHito;

  private readonly folio = toSignal(
    inject(ActivatedRoute).paramMap.pipe(map((p) => p.get('folio') ?? '')),
    { initialValue: '' },
  );

  readonly detalle = computed(() => this.datos.detalle(this.folio()));

  readonly pasos = computed<Paso[]>(() => {
    const d = this.detalle();
    if (!d) return [];
    const actual = ESTADOS.indexOf(d.estado);
    return ESTADOS.map((nombre, k) => ({
      nombre,
      fecha: d.hitos[nombre],
      pendiente: nombre === 'Resuelto' ? 'Pendiente de solución' : 'Pendiente',
      // Si el reporte ya está resuelto, el último paso también cuenta como completado.
      estado: k < actual || (k === actual && nombre === 'Resuelto') ? 'hecho' : k === actual ? 'actual' : 'pendiente',
    }));
  });

  readonly textoSeguidores = computed(() => {
    const d = this.detalle();
    if (!d) return '';
    const n = d.seguidores;
    const personas = n === 1 ? 'persona' : 'personas';
    const verbo = n === 1 ? 'lo sigue' : 'lo siguen';
    if (d.siguiendo) return n ? `Tú y otras ${n} ${personas} ${verbo}` : 'Solo tú sigues este reporte';
    return n ? `${n} ${personas} ${verbo}` : 'Nadie sigue este reporte todavía';
  });

  readonly comentario = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.maxLength(500)],
  });

  readonly enlaceCopiado = signal(false);
  readonly reportado = signal(false);

  alternarSeguimiento(): void {
    this.datos.alternarSeguimiento(this.folio());
  }

  async compartir(): Promise<void> {
    try {
      await navigator.clipboard.writeText(location.href);
      this.enlaceCopiado.set(true);
      setTimeout(() => this.enlaceCopiado.set(false), 2000);
    } catch {
      /* el navegador bloqueó el portapapeles: no hay nada más que hacer */
    }
  }

  comentar(): void {
    const texto = this.comentario.value.trim();
    if (!texto) return;
    this.datos.comentar(this.folio(), texto);
    this.comentario.reset();
  }
}
import { Component, DestroyRef, ElementRef, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { formatearPeso } from '../../core/format';
import { IconComponent } from '../../core/icon.component';
import { IncidenciasService } from '../../core/incidencias.service';
import { CATEGORIAS, CategoriaId, SEDES } from '../../core/models';

interface Adjunto {
  id: number;
  archivo: File;
  nombre: string;
  peso: string;
  vistaPrevia: string | null;
}

const CLAVE_BORRADOR = 'nexo:borrador-reporte';
const MAX_ETIQUETAS = 5;
const MAX_ARCHIVOS = 5;
const MAX_BYTES = 10 * 1024 * 1024;
const TIPOS_PERMITIDOS = ['image/jpeg', 'image/png', 'application/pdf'];
const ETIQUETAS_SUGERIDAS = ['conectividad', 'impresora', 'mantenimiento'];

@Component({
  selector: 'app-nuevo-reporte',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, IconComponent],
  templateUrl: './nuevo-reporte.component.html',
  styleUrl: './nuevo-reporte.component.scss',
})
export class NuevoReporteComponent {
  private readonly fb = inject(FormBuilder);
  private readonly datos = inject(IncidenciasService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly categorias = CATEGORIAS;
  readonly sedes = SEDES;
  readonly maxEtiquetas = MAX_ETIQUETAS;

  readonly form = this.fb.nonNullable.group({
    categoria: ['' as CategoriaId | '', Validators.required],
    sede: ['', Validators.required],
    area: ['', [Validators.required, Validators.maxLength(80)]],
    titulo: ['', [Validators.required, Validators.minLength(5), Validators.maxLength(100)]],
    descripcion: ['', [Validators.required, Validators.minLength(20), Validators.maxLength(2000)]],
  });

  readonly etiquetas = signal<string[]>([]);
  readonly sugeridas = computed(() => ETIQUETAS_SUGERIDAS.filter((s) => !this.etiquetas().includes(s)));

  readonly adjuntos = signal<Adjunto[]>([]);
  readonly erroresArchivo = signal<string[]>([]);
  readonly arrastrando = signal(false);
  private contadorArchivos = 0;

  readonly enviando = signal(false);
  readonly folio = signal<string | null>(null);
  readonly mensajeBorrador = signal('');
  readonly errorEnvio = signal('');

  constructor() {
    this.restaurarBorrador();
    inject(DestroyRef).onDestroy(() => this.adjuntos().forEach((a) => this.liberar(a)));
  }

  get c() {
    return this.form.controls;
  }

  /** Reporte abierto en la misma sede, para evitar duplicados. */
  get similar() {
    const sede = this.c.sede.value;
    if (!sede) return null;
    return this.datos.listas.todas.find((i) => i.edificio === sede && i.estado !== 'Resuelto') ?? null;
  }

  // ---------- Etiquetas ----------
  agregarEtiqueta(texto: string): void {
    const t = texto.trim().toLowerCase().replace(/,/g, '').slice(0, 24);
    if (!t || this.etiquetas().includes(t) || this.etiquetas().length >= MAX_ETIQUETAS) return;
    this.etiquetas.update((e) => [...e, t]);
  }

  quitarEtiqueta(t: string): void {
    this.etiquetas.update((e) => e.filter((x) => x !== t));
  }

  alTeclearEtiqueta(e: KeyboardEvent, input: HTMLInputElement): void {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault(); // evita enviar el formulario con Enter
      this.agregarEtiqueta(input.value);
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value) {
      this.etiquetas.update((lista) => lista.slice(0, -1));
    }
  }

  alSalirEtiqueta(input: HTMLInputElement): void {
    this.agregarEtiqueta(input.value);
    input.value = '';
  }

  // ---------- Evidencia ----------
  agregarArchivos(lista: FileList | null): void {
    if (!lista) return;
    const errores: string[] = [];
    const nuevos: Adjunto[] = [];

    for (const f of Array.from(lista)) {
      if (this.adjuntos().length + nuevos.length >= MAX_ARCHIVOS) {
        errores.push(`Solo puedes adjuntar hasta ${MAX_ARCHIVOS} archivos.`);
        break;
      }
      if (!TIPOS_PERMITIDOS.includes(f.type)) {
        errores.push(`${f.name}: formato no permitido (usa JPG, PNG o PDF).`);
        continue;
      }
      if (f.size > MAX_BYTES) {
        errores.push(`${f.name}: supera los 10 MB.`);
        continue;
      }
      nuevos.push({
        id: ++this.contadorArchivos,
        archivo: f,
        nombre: f.name,
        peso: formatearPeso(f.size),
        vistaPrevia: f.type.startsWith('image/') ? URL.createObjectURL(f) : null,
      });
    }

    this.erroresArchivo.set(errores);
    if (nuevos.length) this.adjuntos.update((a) => [...a, ...nuevos]);
  }

  quitarArchivo(id: number): void {
    const a = this.adjuntos().find((x) => x.id === id);
    if (a) this.liberar(a);
    this.adjuntos.update((lista) => lista.filter((x) => x.id !== id));
  }

  alArrastrar(e: DragEvent, dentro: boolean): void {
    e.preventDefault();
    this.arrastrando.set(dentro);
  }

  alSoltar(e: DragEvent): void {
    e.preventDefault();
    this.arrastrando.set(false);
    this.agregarArchivos(e.dataTransfer?.files ?? null);
  }

  private liberar(a: Adjunto): void {
    if (a.vistaPrevia) URL.revokeObjectURL(a.vistaPrevia);
  }

  // ---------- Borrador (guardado en este navegador) ----------
  guardarBorrador(): void {
    try {
      localStorage.setItem(
        CLAVE_BORRADOR,
        JSON.stringify({ form: this.form.getRawValue(), etiquetas: this.etiquetas() }),
      );
      this.avisar('Borrador guardado');
    } catch {
      this.avisar('No se pudo guardar el borrador');
    }
  }

  private restaurarBorrador(): void {
    try {
      const raw = localStorage.getItem(CLAVE_BORRADOR);
      if (!raw) return;
      const b = JSON.parse(raw);
      this.form.patchValue(b.form ?? {});
      this.etiquetas.set(Array.isArray(b.etiquetas) ? b.etiquetas.slice(0, MAX_ETIQUETAS) : []);
      this.avisar('Recuperamos tu borrador');
    } catch {
      /* borrador corrupto o storage no disponible: se ignora */
    }
  }

  private avisar(texto: string): void {
    this.mensajeBorrador.set(texto);
    setTimeout(() => this.mensajeBorrador.set(''), 2500);
  }

  // ---------- Envío ----------
  async enviar(): Promise<void> {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.host.nativeElement
        .querySelector<HTMLElement>('input.ng-invalid, select.ng-invalid, textarea.ng-invalid')
        ?.focus();
      return;
    }

    this.enviando.set(true);
    this.errorEnvio.set('');
    const v = this.form.getRawValue();
    try {
      const nueva = await this.datos.crear({
        titulo: v.titulo.trim(),
        categoria: v.categoria,
        edificio: v.sede,
        area: v.area.trim(),
        descripcion: v.descripcion.trim(),
        etiquetas: this.etiquetas(),
      });
      localStorage.removeItem(CLAVE_BORRADOR);
      this.folio.set(nueva.folio);
      await this.subirAdjuntos(nueva.folio);
    } catch (error) {
      this.errorEnvio.set(error instanceof Error ? error.message : 'No se pudo enviar el reporte.');
    } finally {
      this.enviando.set(false);
    }
  }

  async reintentarAdjuntos(): Promise<void> {
    const folio = this.folio();
    if (!folio || this.enviando()) return;
    this.enviando.set(true);
    this.errorEnvio.set('');
    try {
      await this.subirAdjuntos(folio);
    } finally {
      this.enviando.set(false);
    }
  }

  private async subirAdjuntos(folio: string): Promise<void> {
    const pendientes: Adjunto[] = [];
    for (const adjunto of this.adjuntos()) {
      try {
        await this.datos.subirEvidencia(folio, adjunto.archivo);
        this.liberar(adjunto);
      } catch (error) {
        pendientes.push(adjunto);
        const detalle = error instanceof Error ? error.message : 'error desconocido';
        this.errorEnvio.update((mensaje) =>
          `${mensaje}${mensaje ? ' ' : ''}${adjunto.nombre}: ${detalle}`,
        );
      }
    }
    this.adjuntos.set(pendientes);
    if (pendientes.length) {
      this.errorEnvio.update((mensaje) => `El reporte ${folio} quedó guardado, pero algunos archivos siguen pendientes. ${mensaje}`);
    }
  }

  otroReporte(): void {
    this.adjuntos().forEach((a) => this.liberar(a));
    this.adjuntos.set([]);
    this.etiquetas.set([]);
    this.erroresArchivo.set([]);
    this.form.reset();
    this.folio.set(null);
    this.errorEnvio.set('');
  }
}
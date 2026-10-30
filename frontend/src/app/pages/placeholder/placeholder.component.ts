import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

@Component({
  selector: 'app-placeholder',
  standalone: true,
  imports: [RouterLink],
  template: `
    <section class="vacio">
      <h1>{{ data['label'] }}</h1>
      <p>{{ data['descripcion'] }}</p>
      <a routerLink="/inicio">Volver al inicio</a>
    </section>
  `,
  styles: `
    .vacio { max-width: 520px; }
    h1 { margin: 0 0 8px; font-size: 28px; font-weight: 500; }
    p { margin: 0 0 20px; color: var(--color-muted); line-height: 1.5; }
    a { font-weight: 600; color: var(--brand); text-decoration: none; }
    a:hover { text-decoration: underline; }
  `,
})
export class PlaceholderComponent {
  readonly data = inject(ActivatedRoute).snapshot.data;
}

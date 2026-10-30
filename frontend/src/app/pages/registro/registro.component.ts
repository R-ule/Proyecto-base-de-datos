import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { SesionService } from '../../core/sesion.service';
import { EMAIL_PATTERN } from '../../core/validation';

@Component({
  selector: 'app-registro',
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink],
  templateUrl: './registro.component.html',
  styleUrl: './registro.component.scss',
})
export class RegistroComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);

  readonly loading = signal(false);
  readonly error = signal('');

  readonly form = this.fb.nonNullable.group({
    nombre: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
    correo: ['', [Validators.required, Validators.pattern(EMAIL_PATTERN)]],
    password: ['', [Validators.required, Validators.minLength(6), Validators.maxLength(8)]],
    confirmarPassword: ['', Validators.required],
  });

  get nombre() { return this.form.controls.nombre; }
  get correo() { return this.form.controls.correo; }
  get password() { return this.form.controls.password; }
  get confirmarPassword() { return this.form.controls.confirmarPassword; }
  get contrasenasCoinciden(): boolean { return this.password.value === this.confirmarPassword.value; }

  async submit(): Promise<void> {
    if (this.form.invalid || !this.contrasenasCoinciden) {
      this.form.markAllAsTouched();
      return;
    }

    this.loading.set(true);
    this.error.set('');
    try {
      const rol = await this.sesion.registrarse(this.nombre.value, this.correo.value, this.password.value);
      await this.router.navigateByUrl(this.sesion.rutaInicial(rol));
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'No se pudo crear la cuenta.');
    } finally {
      this.loading.set(false);
    }
  }
}

import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SesionService } from '../../core/sesion.service';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly router = inject(Router);
  private readonly sesion = inject(SesionService);

  readonly showPassword = signal(false);
  readonly loading = signal(false);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(6)]],
    remember: [true],
  });

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  togglePassword(): void {
    this.showPassword.update((v) => !v);
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    // TODO: conectar con la API de autenticación (JWT) cuando exista el backend.
    const rol = this.sesion.iniciarSesion(this.email.value);
    setTimeout(() => {
      this.loading.set(false);
      this.router.navigateByUrl(this.sesion.rutaInicial(rol));
    }, 600);
  }
}

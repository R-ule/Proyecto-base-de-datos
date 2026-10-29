import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SesionService } from './sesion.service';

/** Solo el perfil Encargado puede entrar; los demás vuelven al inicio. */
export const soloEncargado: CanActivateFn = () => {
  const sesion = inject(SesionService);
  return sesion.esEncargado() ? true : inject(Router).createUrlTree(['/inicio']);
};

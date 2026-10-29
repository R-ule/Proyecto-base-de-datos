import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { Rol, SesionService } from './sesion.service';

/** Solo los perfiles indicados pueden entrar; los demás vuelven a su pantalla de inicio. */
export const soloRoles = (...permitidos: Rol[]): CanActivateFn => () => {
  const sesion = inject(SesionService);
  return permitidos.includes(sesion.rol()) ? true : inject(Router).createUrlTree([sesion.rutaInicial()]);
};

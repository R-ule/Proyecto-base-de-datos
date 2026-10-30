const inicioDeDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

function partes(d: Date) {
  return {
    hora: d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: false }),
    mes: d.toLocaleDateString('es-MX', { month: 'short' }).replace('.', ''),
  };
}

/** "Hoy, 10:24" · "Ayer, 17:30" · "22 oct, 16:40" */
export function formatearActualizacion(fecha: Date, ahora = new Date()): string {
  const { hora, mes } = partes(fecha);
  const dias = Math.round((inicioDeDia(ahora) - inicioDeDia(fecha)) / 86_400_000);
  if (dias <= 0) return `Hoy, ${hora}`;
  if (dias === 1) return `Ayer, ${hora}`;
  return `${fecha.getDate()} ${mes}, ${hora}`;
}

/** 1843200 → "1.8 MB" · 320000 → "313 KB" */
export function formatearPeso(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** "23 oct 2026, 09:40" */
export function formatearFechaCompleta(d: Date): string {
  const { hora, mes } = partes(d);
  return `${d.getDate()} ${mes} ${d.getFullYear()}, ${hora}`;
}

/** "23 oct · 09:40" */
export function formatearHito(d: Date): string {
  const { hora, mes } = partes(d);
  return `${d.getDate()} ${mes} · ${hora}`;
}

/** Día y hora separados para la columna "Atender": { dia: "Hoy", hora: "16:00" } */
export function formatearAtencion(d: Date, ahora = new Date()): { dia: string; hora: string } {
  const { hora, mes } = partes(d);
  const dias = Math.round((inicioDeDia(d) - inicioDeDia(ahora)) / 86_400_000);
  const dia = dias === 0 ? 'Hoy' : dias === 1 ? 'Mañana' : dias === -1 ? 'Ayer' : `${d.getDate()} ${mes}`;
  return { dia, hora };
}

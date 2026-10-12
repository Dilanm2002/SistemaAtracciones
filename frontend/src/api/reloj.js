/**
 * Hora del servidor. Las pruebas DPoP llevan la hora de firma (`iat`) y el servidor rechaza las que
 * se alejan más de 5 minutos de la suya: en una computadora con el reloj desfasado el inicio de
 * sesión fallaba con «Prueba DPoP inválida: hora». Cada respuesta de la API trae su hora (`Date`) y
 * se guarda la diferencia, así las pruebas se firman con la hora del servidor y no con la del equipo.
 */
let desfaseMs = 0;

/** Ahora, en milisegundos, según el reloj del servidor. */
export const ahoraServidor = () => Date.now() + desfaseMs;

/** Ajusta el desfase con la cabecera `Date` de una respuesta. Ignora diferencias menores a 30 s. */
export function sincronizarReloj(res) {
  const servidor = Date.parse(res.headers.get('Date') ?? '');
  if (Number.isNaN(servidor)) return;
  const diferencia = servidor - Date.now();
  desfaseMs = Math.abs(diferencia) > 30_000 ? diferencia : 0;
}

/**
 * MOV-017: el teclado virtual no debe tapar el campo que se está escribiendo.
 * Chrome Android ya redimensiona la página (meta viewport `interactive-widget=resizes-content`);
 * Safari en iPhone no, así que aquí se observa `visualViewport` (la parte que queda visible sobre el
 * teclado) y, si el campo enfocado queda debajo, se desplaza al centro de lo visible.
 */
const CAMPOS = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=file]), textarea, select';

export function protegerCamposDelTeclado() {
  const vv = window.visualViewport;
  if (!vv || !window.matchMedia?.('(pointer: coarse)').matches) return;
  const revisar = () => {
    const el = document.activeElement;
    if (!el?.matches?.(CAMPOS)) return;
    const r = el.getBoundingClientRect();
    const visibleArriba = vv.offsetTop;
    const visibleAbajo = vv.offsetTop + vv.height;
    if (r.bottom > visibleAbajo - 12 || r.top < visibleArriba + 12) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  // Al enfocar, el teclado tarda en aparecer: se revisa cuando cambia el área visible y tras una pausa
  vv.addEventListener('resize', revisar);
  document.addEventListener('focusin', (e) => { if (e.target?.matches?.(CAMPOS)) setTimeout(revisar, 350); });
}

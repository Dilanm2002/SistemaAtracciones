/** Nombre para los selectores del panel: si hay dos con el mismo nombre, se distinguen por su fecha de creación. */
export function nombresUnicos(lista) {
  const veces = new Map();
  for (const a of lista) veces.set(a.name.trim().toLowerCase(), (veces.get(a.name.trim().toLowerCase()) ?? 0) + 1);
  return (a) => {
    if ((veces.get(a.name.trim().toLowerCase()) ?? 0) < 2 || !a.created_at) return a.name;
    const d = new Date(a.created_at);
    return `${a.name} · creada el ${d.toLocaleDateString('es-EC', { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`;
  };
}

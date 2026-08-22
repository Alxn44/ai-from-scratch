// Roadmap de aventura: se abre cuando la persona sube de rango. 12 paradas, el
// viajero avanza hasta la nueva y la parada se enciende. Es una capa encima de
// la lección: no navega, no bloquea, se cierra con Esc, clic fuera o el botón.
export type RoadmapTxt = {
  eb: string; titulo: string; sub: string; cerrar: string; seguir: string;
  rangos: string[]; paradaN: string;
};

const quieto = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const G = () => (window as any).gsap;

export function abrirRoadmap(nivel: number, txt: RoadmapTxt) {
  document.getElementById('roadmap')?.remove();
  const capa = document.createElement('div');
  capa.id = 'roadmap';
  capa.setAttribute('style', 'position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);opacity:0');

  const paradas = Array.from({ length: 12 }, (_, i) => i + 1);
  const ancho = 1000, alto = 190;
  const px = (n: number) => 44 + ((n - 1) * (ancho - 88)) / 11;
  const py = (n: number) => alto / 2 + Math.sin(n * 0.9) * 42;
  const camino = paradas.map((n) => `${n === 1 ? 'M' : 'L'}${px(n).toFixed(1)},${py(n).toFixed(1)}`).join(' ');

  capa.innerHTML = `
    <div style="width:min(1060px,94vw);border:1px solid var(--hair);background:var(--bg);padding:28px 30px 26px;display:flex;flex-direction:column;gap:18px">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:20px">
        <div style="display:flex;flex-direction:column;gap:9px">
          <p class="eb">${txt.eb}</p>
          <div class="h1" style="font-size:34px">${txt.rangos[nivel - 1] ?? ''}</div>
          <p class="s" style="color:var(--l2)">${txt.sub}</p>
        </div>
        <button id="rm-x" class="btn ghost" style="height:36px">${txt.cerrar}</button>
      </div>
      <svg viewBox="0 0 ${ancho} ${alto}" style="width:100%;height:auto;overflow:visible">
        <path d="${camino}" fill="none" stroke="var(--hair)" stroke-width="2" stroke-dasharray="5 7"/>
        <path id="rm-hecho" d="${camino}" fill="none" stroke="var(--ac)" stroke-width="2.5"/>
        ${paradas.map((n) => `
          <g data-parada="${n}" opacity="${n <= nivel ? 1 : 0.38}">
            <circle cx="${px(n)}" cy="${py(n)}" r="${n === nivel ? 13 : 9}"
              fill="${n <= nivel ? 'var(--ac)' : 'var(--bg)'}" stroke="${n <= nivel ? 'var(--ac)' : 'var(--hair)'}" stroke-width="2"/>
            <text x="${px(n)}" y="${py(n) + 4}" text-anchor="middle"
              style="font:600 10px/1 var(--m);fill:${n <= nivel ? '#fff' : 'var(--l3)'}">${n}</text>
            <text x="${px(n)}" y="${py(n) - 22}" text-anchor="middle"
              style="font:500 9px/1 var(--m);letter-spacing:.1em;text-transform:uppercase;fill:var(--l3)">${(txt.rangos[n - 1] ?? '').split(' ')[0]}</text>
          </g>`).join('')}
        <g id="rm-viajero" opacity="0">
          <circle r="6" fill="var(--l1)"/>
        </g>
      </svg>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;border-top:1px solid var(--hair2);padding-top:16px">
        <p class="lbl">${txt.paradaN.replace('{n}', String(nivel)).replace('{t}', '12')}</p>
        <button id="rm-go" class="btn">${txt.seguir}</button>
      </div>
    </div>`;

  document.body.append(capa);
  const cerrar = () => {
    const g = G();
    if (quieto() || !g) { capa.remove(); return; }
    g.to(capa, { opacity: 0, duration: 0.18, onComplete: () => capa.remove() });
  };
  capa.addEventListener('click', (e) => { if (e.target === capa) cerrar(); });
  capa.querySelector<HTMLElement>('#rm-x')!.onclick = cerrar;
  capa.querySelector<HTMLElement>('#rm-go')!.onclick = cerrar;
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { cerrar(); document.removeEventListener('keydown', esc); } };
  document.addEventListener('keydown', esc);

  const hecho = capa.querySelector<SVGPathElement>('#rm-hecho')!;
  const largo = hecho.getTotalLength();
  const hasta = (largo * (nivel - 1)) / 11;
  hecho.style.strokeDasharray = `${largo}`;
  hecho.style.strokeDashoffset = `${largo}`;

  const g = G();
  if (quieto() || !g) {
    capa.style.opacity = '1';
    hecho.style.strokeDashoffset = `${largo - hasta}`;
    return;
  }
  const viajero = capa.querySelector<SVGGElement>('#rm-viajero')!;
  g.to(capa, { opacity: 1, duration: 0.2 });
  g.to(hecho, { strokeDashoffset: largo - hasta, duration: 1.1, ease: 'power2.inOut' });
  g.to(viajero, { opacity: 1, duration: 0.2 });
  // El viajero recorre el trazo: se lee como avance, no como decoración.
  const t = { p: 0 };
  g.to(t, {
    p: 1, duration: 1.1, ease: 'power2.inOut',
    onUpdate: () => {
      const pt = hecho.getPointAtLength(hasta * t.p);
      viajero.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    },
  });
  const foco = capa.querySelector<SVGGElement>(`[data-parada="${nivel}"]`);
  if (foco) g.fromTo(foco, { scale: 0.4, transformOrigin: 'center' }, { scale: 1, duration: 0.5, delay: 1.0, ease: 'back.out(3)' });
}

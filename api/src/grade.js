// La corrección vive SOLO en el servidor: el cliente nunca recibe `solution`.
const norm = (xs) => xs.map(String).map((s) => s.trim()).sort().join('|');

export function grade(lab, answer) {
  const sol = JSON.parse(lab.solution);
  switch (lab.kind) {
    case 'choice':
      return String(answer) === String(sol.value);
    case 'cut':
      return Array.isArray(answer) && norm(answer) === norm(sol.cuts);
    case 'order':
      return Array.isArray(answer) && answer.map(String).join(',') === sol.order.map(String).join(',');
    case 'build':
      return answer && typeof answer === 'object' &&
             sol.slots.every((k, i) => typeof answer[i] === 'string' && answer[i].trim().length > 0);
    case 'knob': {
      const t = Number(answer);
      return Number.isFinite(t) && t >= sol.min && t <= sol.max;
    }
    case 'hotcold':
      return Number(answer) === Number(sol.value);
    default:
      return false;
  }
}

// Pista devuelta al cliente cuando la mecánica la necesita.
// Sin esto el cliente tendría que conocer la respuesta para decir «frío» o «caliente».
export function hint(lab, answer) {
  const sol = JSON.parse(lab.solution);
  if (lab.kind === 'hotcold') {
    const err = Math.abs(Number(answer) - Number(sol.value));
    const word = err === 0 ? 'exacto' : err <= 5 ? 'caliente' : err <= 20 ? 'tibio' : 'frío';
    return { err, word };
  }
  if (lab.kind === 'knob') return { range: [sol.min, sol.max] };
  return null;
}

// Lo que sí puede ver el cliente.
export function publicLab(lab, best) {
  return {
    id: lab.id,
    lesson: lab.lesson_n,
    idx: lab.idx,
    level: lab.level,
    kind: lab.kind,
    prompt: lab.prompt,
    payload: JSON.parse(lab.payload),
    draft: !!lab.draft,
    solved: !!best,
    attempts: best?.attempts ?? 0,
  };
}

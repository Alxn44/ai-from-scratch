// Quiz and exam questions. Grading is on the server; this only collects the pick.

type Option = { id: string; text: string };
export type Question = {
  id: string; kind: string; pack: string; idx: number; lesson: number;
  prompt: string; options: Option[]; solved: boolean; attempts: number;
};
export type Score = { correct: number; total: number; passed: boolean; passAt: number };

type Txt = {
  comprobar: string; deNuevo: string; sinResp: string; sinRespB: string;
  correcto: string; todaviaNo: string; sinRed: string; sinRedB: string;
  aprobado?: string; noAprobado?: string; corte?: string;
};

declare global { interface Window { toast: (k: string, t: string, b: string, key?: string) => void } }

const el = (tag: string, style: string) => {
  const n = document.createElement(tag);
  n.setAttribute('style', style);
  return n;
};

export function mountQuestions(host: HTMLElement, questions: Question[], txt: Txt, onScore?: (s: Score) => void): void {
  host.querySelectorAll<HTMLElement>('[data-q]').forEach((root) => {
    const q = questions.find((x) => x.id === root.dataset.q);
    if (!q) return;
    const stage = root.querySelector('[data-q-stage]') as HTMLElement;
    const out = root.querySelector('[data-q-out]') as HTMLElement;
    const check = root.querySelector('[data-q-check]') as HTMLButtonElement;
    const reset = root.querySelector('[data-q-reset]') as HTMLButtonElement;
    let pick: string | null = null;
    let requesting = false;
    root.dataset.solved = q.solved ? 'true' : 'false';
    if (q.solved) {
      const status = el('p', 'color:var(--ok)');
      status.className = 's';
      status.textContent = txt.correcto;
      out.append(status);
    }

    const paint = () => {
      stage.innerHTML = '';
      const row = el('div', 'display:flex;flex-direction:column;gap:8px');
      for (const o of q.options) {
        const b = el('button', 'text-align:left;justify-content:flex-start') as HTMLButtonElement;
        b.type = 'button';
        b.className = 'chip';
        b.style.width = '100%';
        b.textContent = o.text;
        b.setAttribute('aria-pressed', String(pick === o.id));
        b.disabled = requesting;
        if (pick === o.id) b.setAttribute(root.dataset.result === 'ok' ? 'data-ok' : root.dataset.result === 'bad' ? 'data-bad' : 'data-on', '');
        b.addEventListener('click', () => {
          pick = o.id;
          delete root.dataset.result;
          out.textContent = '';
          paint();
        });
        row.append(b);
      }
      stage.append(row);
    };

    check.addEventListener('click', async () => {
      if (!pick) {
        window.toast?.('warn', txt.sinResp, txt.sinRespB);
        return;
      }
      requesting = true;
      check.disabled = true;
      reset.disabled = true;
      paint();
      try {
        const res = await fetch(`/api/questions/${q.id}/attempt`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ answer: pick }),
        });
        const d = await res.json().catch(() => ({}));
        if (!res.ok) {
          window.toast?.('bad', txt.sinRed, d.msg ?? txt.sinRedB);
          return;
        }
        root.dataset.result = d.correct ? 'ok' : 'bad';
        out.textContent = '';
        const status = el('p', `color:${d.correct ? 'var(--ok)' : 'var(--rd)'}`);
        status.className = 's';
        status.textContent = d.correct ? txt.correcto : txt.todaviaNo;
        out.append(status);
        if (d.explanation) {
          const p = el('p', 'margin-top:8px;color:var(--l2)');
          p.className = 's';
          p.textContent = String(d.explanation);
          out.append(p);
        }
        if (d.correct) q.solved = true;
        q.attempts += 1;
        paint();
        if (d.score && onScore) onScore(d.score);
      } catch {
        window.toast?.('bad', txt.sinRed, txt.sinRedB);
      } finally {
        requesting = false;
        check.disabled = false;
        reset.disabled = false;
        paint();
      }
    });
    reset.addEventListener('click', () => {
      pick = null;
      delete root.dataset.result;
      out.textContent = '';
      paint();
    });
    paint();
  });
}

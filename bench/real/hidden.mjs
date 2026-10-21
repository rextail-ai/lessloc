// A task's hidden tests travel as a bundle that mirrors the repository: test files under unique names in their real folders,
// and the data files their change added. While graded, bundles are laid over a working tree; afterwards everything they
// covered is put back and their compiled files are removed, so nothing is left for the next agent to find.
import fs from 'node:fs';
import path from 'node:path';

export const under = (f, dirs) => dirs.some(d => f === d || f.startsWith(`${d}/`));
export const filesIn = dir => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).filter(f => fs.statSync(path.join(dir, f)).isFile()) : []);
export function overlay(dir, bundles) {
  const undo = [];
  for (const b of bundles) for (const f of filesIn(b)) {
    const dest = path.join(dir, f), had = fs.existsSync(dest) ? fs.readFileSync(dest) : null, made = [];
    for (let d = path.dirname(dest); !fs.existsSync(d); d = path.dirname(d)) made.unshift(d);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(b, f), dest);
    undo.push(() => {
      if (had) fs.writeFileSync(dest, had);
      else fs.rmSync(dest, { force: true });
      const cache = path.join(path.dirname(dest), '__pycache__');
      if (f.endsWith('.py') && fs.existsSync(cache)) for (const c of fs.readdirSync(cache).filter(c => c.startsWith(`${path.basename(f, '.py')}.`))) fs.rmSync(path.join(cache, c));
      for (const d of made.reverse()) fs.rmSync(d, { recursive: true, force: true });
    });
  }
  return () => undo.reverse().forEach(u => u());
}

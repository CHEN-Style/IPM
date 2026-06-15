// Minimal hash router. Routes are registered as patterns like
// '#/orgs' or '#/orgs/:id'; the active handler renders into the shell.

const routes = [];
let notFound = null;

export function route(pattern, handler) {
  const keys = [];
  const rx = new RegExp(
    '^' + pattern.replace(/:[^/]+/g, (m) => { keys.push(m.slice(1)); return '([^/]+)'; }) + '$',
  );
  routes.push({ rx, keys, handler });
}

export function setNotFound(fn) { notFound = fn; }

export function navigate(hash) {
  if (location.hash === hash) resolve();
  else location.hash = hash;
}

export function current() {
  return location.hash.replace(/^#/, '') || '/';
}

export function resolve() {
  const path = current();
  for (const r of routes) {
    const m = r.rx.exec(path);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      r.handler(params);
      return;
    }
  }
  if (notFound) notFound();
}

export function start() {
  window.addEventListener('hashchange', resolve);
  resolve();
}

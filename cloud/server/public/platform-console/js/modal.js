// Simple modal helper. openModal({ title, subtitle, body, footer }) returns a
// close() function. Footer buttons are caller-provided nodes.

import { h } from './util.js';

export function openModal({ title, subtitle, body, footer, width }) {
  const mask = h('div.modal-mask');
  const modal = h('div.modal');
  if (width) modal.style.width = `${width}px`;
  const head = h('div.modal-head', {}, [
    h('h3', { text: title }),
    subtitle ? h('p', { text: subtitle }) : null,
  ]);
  modal.append(head);
  if (body) modal.append(h('div.modal-body', {}, body));
  if (footer) modal.append(h('div.modal-foot', {}, footer));
  mask.append(modal);
  mask.addEventListener('mousedown', (e) => { if (e.target === mask) close(); });
  document.body.append(mask);
  function close() { mask.remove(); }
  return { close, modal };
}

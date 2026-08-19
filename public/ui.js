/**
 * Tiny DOM helpers. No framework, no build step.
 *
 * Everything a player types (names, above all) goes in as TEXT, never markup —
 * `h()` has no way to inject HTML, which is what keeps a player called
 * `<script>` from being interesting.
 */

/**
 * Build an element.
 * @param {string} tag e.g. 'div', 'button.btn.btn--primary'
 * @param {object} [props] className, text, on*, data-*, aria-*, disabled, type, value
 * @param {...(Node|string|null|undefined|Array)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name);
  if (classes.length) el.className = classes.join(' ');

  if (props && typeof props === 'object' && !(props instanceof Node) && !Array.isArray(props)) {
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'className') el.className = `${el.className} ${value}`.trim();
      else if (key === 'text') el.textContent = String(value);
      else if (key === 'html') el.appendChild(fragment(value));
      else if (key.startsWith('on') && typeof value === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), value);
      } else if (key === 'style' && typeof value === 'object') {
        // Set through the CSSOM rather than a style attribute, so the page can
        // keep a strict Content-Security-Policy with no 'unsafe-inline'.
        for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
      } else if (value === true) el.setAttribute(key, '');
      else el.setAttribute(key, String(value));
    }
  } else if (props !== undefined && props !== null) {
    children.unshift(props);
  }

  append(el, children);
  return el;
}

/** Append children of any shape, skipping the empty ones. */
export function append(parent, children) {
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return parent;
}

/**
 * Parse a trusted markup string (our own SVG constants only) with correct
 * namespaces. Never call this with anything a player typed.
 */
export function fragment(markup) {
  return document.createRange().createContextualFragment(markup);
}

/** Replace an element's children in one go. */
export function fill(el, ...children) {
  el.replaceChildren();
  append(el, children);
  return el;
}

/** First two letters of a name, for the avatar tile. */
export function initials(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1) return (parts[0][0] + parts[1][0]).toUpperCase();
  return trimmed.slice(0, 2).toUpperCase();
}

/** "3 players" / "1 player" */
export function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

/** A friendly date for the history list. */
export function friendlyDate(ms) {
  const date = new Date(ms);
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A short time, for the history list. */
export function friendlyTime(ms) {
  return new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Does the player want animation kept to a minimum? */
export function reducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A short buzz for a meaningful moment, where the phone supports it. */
export function buzz(pattern) {
  if (reducedMotion()) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* not supported, and not important */
  }
}

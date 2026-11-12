// Hash routes, so the site works from any static host and offline:
//   #/letter/<id>?h=<hand: qajar|note>&w=<seed>&paper=
//   #/letters   #/read/<id>   #/about
import { useEffect, useState } from 'react';

export type Route =
  | { name: 'letter'; id: string; params: Record<string, string> }
  | { name: 'letters'; params: Record<string, string> }
  | { name: 'read'; id: string; params: Record<string, string> }
  | { name: 'about'; params: Record<string, string> };

export function parse(hash: string): Route {
  const [path, q = ''] = hash.replace(/^#/, '').split('?');
  const params = Object.fromEntries(new URLSearchParams(q));
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'letters') return { name: 'letters', params };
  if (parts[0] === 'about') return { name: 'about', params };
  if (parts[0] === 'read' && parts[1]) return { name: 'read', id: decodeURIComponent(parts[1]), params };
  return { name: 'letter', id: parts[1] ? decodeURIComponent(parts[1]) : '', params };
}

export function href(r: Route): string {
  const q = new URLSearchParams(Object.entries(r.params).filter(([, v]) => v !== undefined && v !== '') as [string, string][]).toString();
  const path = r.name === 'letter' ? `/letter/${r.id}` : r.name === 'read' ? `/read/${r.id}` : `/${r.name}`;
  return `#${path}${q ? '?' + q : ''}`;
}

export function navigate(r: Route, replace = false) {
  const h = href(r);
  if (replace) history.replaceState(null, '', h);
  else history.pushState(null, '', h);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute(): Route {
  const [r, setR] = useState(() => parse(location.hash));
  useEffect(() => {
    const on = () => setR(parse(location.hash));
    window.addEventListener('hashchange', on);
    window.addEventListener('popstate', on);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('popstate', on); };
  }, []);
  return r;
}

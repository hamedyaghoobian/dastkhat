import { useEffect, useState } from 'react';
import { loadScript, type Script, type Style } from './engine/script';
import { Desk } from './pages/Desk';
import { Library } from './pages/Library';
import { Read } from './pages/Read';
import { About } from './pages/About';
import { LETTERS, pickNext } from './lib/letters';
import { navigate, useRoute } from './lib/route';

export default function App() {
  const route = useRoute();
  const [script, setScript] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const style: Style = route.name === 'letter' && route.params.style === 'naskh' ? 'naskh' : 'nastaliq';

  useEffect(() => {
    let live = true;
    loadScript(style).then((s) => { if (live) setScript(s); }).catch((e) => setError(String(e)));
    return () => { live = false; };
  }, [style]);

  // the desk always opens on a letter, in a hand
  useEffect(() => {
    if (route.name === 'letter' && (!route.id || !route.params.w)) {
      const first = route.id || pickNext(null, Math.floor(Math.random() * 1e6)).id;
      navigate({ name: 'letter', id: first, params: { ...route.params, w: route.params.w || 'baran-roshan-17' } }, true);
    }
  }, [route]);

  const here = route.name === 'read' ? 'letters' : route.name;
  return (
    <>
      <header className="topbar">
        <a className="brand" href="#/">دست‌خط <small>نامه‌های واقعی، دست‌های ساختگی</small></a>
        <nav className="nav" aria-label="بخش‌ها">
          <a href="#/" aria-current={here === 'letter' ? 'page' : undefined}>میز</a>
          <a href="#/letters" aria-current={here === 'letters' ? 'page' : undefined}>همهٔ نامه‌ها ({LETTERS.length.toLocaleString('fa')})</a>
          <a href="#/about" aria-current={here === 'about' ? 'page' : undefined}>درباره</a>
        </nav>
      </header>
      {error && <p className="prose">بارگذاری موتور خط ناموفق بود: {error}</p>}
      {route.name === 'letters' && <Library />}
      {route.name === 'read' && <Read id={route.id} />}
      {route.name === 'about' && <About />}
      {route.name === 'letter' && route.id && route.params.w && (script && script.style === style
        ? <Desk route={route} script={script} />
        : <p className="prose hint">قلم را آماده می‌کنیم…</p>)}
    </>
  );
}

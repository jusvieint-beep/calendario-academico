'use client';

import { useEffect, useState } from 'react';
import { MoonIcon, SunIcon } from './Icons';

function currentTheme(): 'dark' | 'light' {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light' | null>(null);

  useEffect(() => setTheme(currentTheme()), []);

  const toggle = () => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('cal-theme', next); } catch { /* sin almacenamiento */ }
    setTheme(next);
  };

  return (
    <button className="icon-btn" type="button" onClick={toggle} aria-label="Cambiar tema" title="Cambiar tema">
      {theme === 'light' ? <MoonIcon /> : <SunIcon />}
    </button>
  );
}

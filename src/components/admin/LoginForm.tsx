'use client';

import { useState, type FormEvent } from 'react';
import { createBrowserSupabase } from '@/lib/supabase/browser';
import { ErrorIcon } from '../Icons';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (authError) {
      setBusy(false);
      setError(
        authError.message.toLowerCase().includes('invalid')
          ? 'Correo o contraseña incorrectos.'
          : `No se pudo iniciar sesión: ${authError.message}`
      );
      return;
    }
    // Navegación completa para que el servidor lea la nueva sesión.
    window.location.assign('/admin');
  };

  return (
    <form className="login-box" onSubmit={submit}>
      <div className="brand-mark" aria-hidden="true" />
      <h1>Panel administrativo</h1>
      <p>Solo para quien actualiza el calendario.</p>
      {error && <div className="alert a-err" role="alert"><ErrorIcon /><div>{error}</div></div>}
      <div className="field">
        <label htmlFor="email">Correo</label>
        <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <button className="btn btn-primary" type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
    </form>
  );
}

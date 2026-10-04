import { createServerClient } from '@supabase/ssr';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { SUPABASE_KEY, SUPABASE_URL } from '../env';

/** Cliente con la sesión del usuario (cookies). Para el panel /admin y sus API. */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL(), SUPABASE_KEY(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // En componentes de servidor no se pueden escribir cookies; el middleware las renueva.
        }
      }
    }
  });
}

/** Cliente anónimo sin cookies. Para la página pública (permite caché). */
export function createPublicSupabase() {
  return createClient(SUPABASE_URL(), SUPABASE_KEY(), {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

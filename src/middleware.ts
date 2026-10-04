import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Renueva la sesión de Supabase y protege /admin.
 * La verificación de rol (tabla admins) se hace en el servidor de cada página y API,
 * y además la base de datos la vuelve a comprobar en cada operación.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return response;

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      }
    }
  });

  const { data: { user } } = await supabase.auth.getUser();
  const path = request.nextUrl.pathname;

  if (path.startsWith('/admin') && path !== '/admin/login' && !user) {
    const login = request.nextUrl.clone();
    login.pathname = '/admin/login';
    login.search = '';
    return NextResponse.redirect(login);
  }

  if (path === '/admin/login' && user) {
    const admin = request.nextUrl.clone();
    admin.pathname = '/admin';
    admin.search = '';
    return NextResponse.redirect(admin);
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/api/import/:path*', '/api/excel/:path*', '/auth/:path*']
};

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisa .env.local o la configuración de Vercel.`);
  }
  return value;
}

// Se leen de forma explícita para que Next.js las incluya en el navegador.
export const SUPABASE_URL = () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL);
export const SUPABASE_KEY = () =>
  required(
    'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

export const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'Calendario Académico';
export const APP_SUBTITLE = process.env.NEXT_PUBLIC_APP_SUBTITLE || 'Sesiones y entregas · hora de Colombia';

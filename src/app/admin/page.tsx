import { redirect } from 'next/navigation';
import AdminDashboard from '@/components/admin/AdminDashboard';
import Header from '@/components/Header';
import { getAdminContext } from '@/lib/auth';
import { fetchCalendarState, fetchEvents } from '@/lib/data';
import { nowInBogota } from '@/lib/dates';
import { APP_NAME } from '@/lib/env';
import type { ImportRecord } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const metadata = { title: `Administración · ${APP_NAME}` };

export default async function AdminPage() {
  const ctx = await getAdminContext();
  if (!ctx.user) redirect('/admin/login');

  const header = (
    <Header
      appName={APP_NAME}
      subtitle="Panel administrativo"
      right={
        <>
          <a className="btn btn-ghost" href="/" target="_blank" rel="noopener noreferrer">Ver página pública</a>
          <form action="/auth/signout" method="post"><button className="btn btn-ghost" type="submit">Cerrar sesión</button></form>
        </>
      }
    />
  );

  if (!ctx.isAdmin) {
    return (
      <main>
        {header}
        <div className="box">
          <h2 style={{ margin: 0 }}>Sin permisos de administrador</h2>
          <p style={{ margin: 0, color: 'var(--text-dim)' }}>
            El usuario {ctx.user.email} inició sesión, pero no está autorizado. Pide que lo agreguen a la tabla «admins» en Supabase.
          </p>
        </div>
      </main>
    );
  }

  const [events, state, importsRes, snapsRes] = await Promise.all([
    fetchEvents(ctx.supabase),
    fetchCalendarState(ctx.supabase),
    ctx.supabase
      .from('imports')
      .select('id, admin_email, kind, status, file_name, rows_before, rows_after, created_count, updated_count, deleted_count, unchanged_count, error_message, restored_from, created_at')
      .order('created_at', { ascending: false })
      .limit(30),
    ctx.supabase.from('event_snapshots').select('import_id')
  ]);

  const snapshotIds = new Set(((snapsRes.data ?? []) as { import_id: string }[]).map((s) => s.import_id));
  const imports: ImportRecord[] = ((importsRes.data ?? []) as Omit<ImportRecord, 'has_snapshot'>[]).map((r) => ({
    ...r,
    has_snapshot: snapshotIds.has(r.id)
  }));

  return (
    <main>
      {header}
      <AdminDashboard
        adminName={ctx.name}
        events={events}
        imports={imports}
        version={state.version}
        serverNow={nowInBogota()}
      />
    </main>
  );
}

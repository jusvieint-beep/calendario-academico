import LoginForm from '@/components/admin/LoginForm';
import Header from '@/components/Header';
import { APP_NAME, APP_SUBTITLE } from '@/lib/env';

export const metadata = { title: `Ingreso · ${APP_NAME}` };

export default function LoginPage() {
  return (
    <main>
      <Header appName={APP_NAME} subtitle={APP_SUBTITLE} />
      <LoginForm />
    </main>
  );
}

import { useNavigate } from 'react-router';

import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/use-auth';

export function SettingsPage() {
  const { logout, session } = useAuth();
  const navigate = useNavigate();

  async function onLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <section className="grid gap-2">
        <h2 className="text-base font-medium">设置</h2>
        <div className="text-sm">{session?.email ?? '-'}</div>
        <div>
          <Button variant="outline" onClick={onLogout}>
            退出登录
          </Button>
        </div>
      </section>
    </main>
  );
}

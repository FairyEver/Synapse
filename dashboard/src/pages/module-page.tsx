import { Navigate } from 'react-router';

import { useAuth } from '@/hooks/use-auth';

type ModulePageProps = {
  permissionKey: string;
  title: string;
};

export function ModulePage({ permissionKey, title }: ModulePageProps) {
  const { session } = useAuth();

  if (
    session?.role !== 'user' ||
    !session.modulePermissions.includes(permissionKey)
  ) {
    return <Navigate to="/me" replace />;
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <section className="grid gap-2">
        <h2 className="text-base font-medium">{title}</h2>
        <div className="text-sm">{session.email}</div>
      </section>
    </main>
  );
}

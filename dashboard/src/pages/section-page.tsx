import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function SectionPage({ title }: { title: string }) {
  return (
    <main className="flex min-w-0 flex-1 flex-col gap-4 overflow-x-hidden overflow-y-auto p-4 pt-0">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            请使用有效邀请链接继续。
          </p>
        </CardContent>
      </Card>
    </main>
  );
}

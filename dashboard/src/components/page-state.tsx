import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export function LoadingState() {
  return <div className="p-4 text-sm text-muted-foreground">加载中</div>;
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between gap-4">
        <p className="text-sm text-destructive">{message}</p>
        <Button variant="outline" onClick={onRetry}>
          重试
        </Button>
      </CardContent>
    </Card>
  );
}

export function EmptyState() {
  return <p className="p-4 text-sm text-muted-foreground">暂无记录</p>;
}

export type FeedbackState = {
  message: string;
  tone: 'error' | 'neutral';
};

export function FeedbackMessage({ feedback }: { feedback: FeedbackState | null }) {
  if (!feedback) return null;
  return (
    <p
      className={
        feedback.tone === 'error'
          ? 'text-sm text-destructive'
          : 'text-sm text-muted-foreground'
      }
    >
      {feedback.message}
    </p>
  );
}

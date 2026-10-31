import { Button } from '@heroui/react';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
type GeneralErrorProps = React.HTMLAttributes<HTMLDivElement> & {
    minimal?: boolean;
};
export function GeneralError({ className, minimal = false, }: GeneralErrorProps) {
    const navigate = useNavigate();
    const { history } = useRouter();
    return (<div className={cn('h-svh w-full', className)}>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        {!minimal && (<h1 className='text-[7rem] leading-tight font-bold'>500</h1>)}
        <span className='font-medium'>出错了</span>
        <p className='text-center text-muted'>
          当前页面暂时无法打开。<br />请稍后重试。
        </p>
        {!minimal && (<div className='mt-6 flex gap-4'>
            <Button variant="outline" onPress={() => history.go(-1)}>
              返回上一页
            </Button>
            <Button onPress={() => navigate({ to: '/' })}>返回首页</Button>
          </div>)}
      </div>
    </div>);
}

import { Button } from '@heroui/react';
import { useNavigate, useRouter } from '@tanstack/react-router';
export function ForbiddenError() {
    const navigate = useNavigate();
    const { history } = useRouter();
    return (<div className='h-svh'>
      <div className='m-auto flex h-full w-full flex-col items-center justify-center gap-2'>
        <h1 className='text-[7rem] leading-tight font-bold'>403</h1>
        <span className='font-medium'>无权访问</span>
        <p className='text-center text-muted'>
          当前账号没有权限<br />
          查看该资源。
        </p>
        <div className='mt-6 flex gap-4'>
          <Button variant="outline" onPress={() => history.go(-1)}>
            返回上一页
          </Button>
          <Button onPress={() => navigate({ to: '/' })}>返回首页</Button>
        </div>
      </div>
    </div>);
}

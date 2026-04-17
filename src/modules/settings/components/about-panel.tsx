import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

type AboutPanelProps = {
  version: string
}

function AboutPanel({ version }: AboutPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>软件更新</CardTitle>
        <CardDescription>
          这里只先搭好关于页骨架。真正的更新检查、下载进度和重启安装会在步骤 18 接入。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">已安装版本</p>
          <p className="text-sm text-muted-foreground">v{version}</p>
        </div>
        <div>
          <Button variant="outline" disabled>
            检查更新
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export { AboutPanel }

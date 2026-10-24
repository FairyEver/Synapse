import { toast } from "sonner"

export function useCopyMailAddress() {
  return async (address: string) => {
    try { await navigator.clipboard.writeText(address); toast("邮箱地址已复制") }
    catch { toast.error("复制失败") }
  }
}

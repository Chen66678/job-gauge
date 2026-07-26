// 主进程 IPC handler 捕获异常后以 { error } 信封返回而非 reject，
// 渲染层必须 unwrap 才能恢复 throw 语义，否则失败会被静默吞掉。
export type CoreApiResult<T> = T | { error: string }

export function unwrap<T>(result: CoreApiResult<T>): T {
  if (result && typeof result === 'object' && 'error' in result) {
    throw new Error(result.error)
  }
  return result as T
}

export function errorText(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

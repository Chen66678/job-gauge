import type { CoreApiResult } from './coreApiResult'
import type { WorkflowApi } from './workflowApi'

declare global {
  interface Window {
    coreApi: WorkflowApi & {
      copyResumeImage: (jobId: string) => Promise<CoreApiResult<void>>
      openExternalUrl: (url: string) => Promise<CoreApiResult<void>>
    }
  }
}

export {}

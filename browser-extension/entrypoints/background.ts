// Background service worker.
//
// Sole network egress point for this extension: only ever POSTs to
// 127.0.0.1 on one of the candidate ports below. No other network calls are
// made anywhere in this extension.

import type { JdPayload } from './content';

const CANDIDATE_PORTS = [8765, 8766, 8767];

type JdExtractedMessage = { type: 'JD_EXTRACTED'; payload: JdPayload };
type PostResult = { ok: true } | { ok: false; error: string };

async function postToLocalApp(payload: JdPayload): Promise<PostResult> {
  let lastError = '未能连接到本地应用';

  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        lastError = `端口 ${port} 返回 HTTP ${response.status}`;
        continue;
      }

      const data = (await response.json()) as { ok?: boolean };
      if (data.ok) {
        return { ok: true };
      }
      lastError = `端口 ${port} 响应未确认成功`;
    } catch (err) {
      lastError = `端口 ${port} 连接失败: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return { ok: false, error: lastError };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (message: JdExtractedMessage, _sender, sendResponse: (response: PostResult) => void) => {
      if (message?.type !== 'JD_EXTRACTED') {
        return undefined;
      }

      postToLocalApp(message.payload).then(sendResponse);
      return true;
    },
  );
});

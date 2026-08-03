// Background service worker.
//
// Sole network egress point for this extension: only ever sends requests to
// 127.0.0.1 on one of the candidate ports below. No other network calls are
// made anywhere in this extension.

import type { JdPayload } from './content';
import { LOCAL_API_TOKEN_STORAGE_KEY } from './shared/localApiToken';

const CANDIDATE_PORTS = [8765, 8766, 8767];

type JdExtractedMessage = { type: 'JD_EXTRACTED'; payload: JdPayload };
type PostResult = { ok: true } | { ok: false; error: string };

async function getStoredToken(): Promise<string> {
  const stored = await chrome.storage.local.get(LOCAL_API_TOKEN_STORAGE_KEY);
  const token = stored[LOCAL_API_TOKEN_STORAGE_KEY];
  return typeof token === 'string' ? token : '';
}

async function getResponseError(response: Response): Promise<string | null> {
  try {
    const data = (await response.clone().json()) as { error?: unknown };
    return typeof data.error === 'string' && data.error.trim() ? data.error : null;
  } catch {
    return null;
  }
}

async function postToLocalApp(payload: JdPayload): Promise<PostResult> {
  let lastError = '未能连接到本地应用';
  const token = await getStoredToken();
  if (!token) {
    return { ok: false, error: '未配置本地应用配对 token，请在插件「选项」中粘贴 token' };
  }

  for (const port of CANDIDATE_PORTS) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Radar-Token': token },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        if (response.status === 403) {
          return { ok: false, error: `端口 ${port} 拒绝访问，请检查 token 是否配置正确` };
        }
        return {
          ok: false,
          error: await getResponseError(response) ?? `端口 ${port} 返回 HTTP ${response.status}`,
        };
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
    (
      message: JdExtractedMessage,
      _sender,
      sendResponse: (response: PostResult) => void,
    ) => {
      if (message?.type === 'JD_EXTRACTED') {
        postToLocalApp(message.payload).then(sendResponse);
        return true;
      }

      return undefined;
    },
  );
});

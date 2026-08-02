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
type ResumeImageRequestedMessage = { type: 'RESUME_IMAGE_REQUESTED'; jobId: string };
type ResumeImageResult =
  | { ok: true; mimeType: string; dataBase64: string }
  | { ok: false; error: string };

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

export async function fetchResumeImage(jobId: string): Promise<Blob> {
  let lastError = '未能连接到本地应用';
  const token = await getStoredToken();
  if (!token) {
    throw new Error('未配置本地应用配对 token，请在插件「选项」中粘贴 token');
  }

  for (const port of CANDIDATE_PORTS) {
    let response: Response;
    try {
      response = await fetch(`http://127.0.0.1:${port}/api/resume-image?jobId=${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { 'X-Radar-Token': token },
      });
    } catch (err) {
      lastError = `端口 ${port} 连接失败: ${err instanceof Error ? err.message : String(err)}`;
      continue;
    }

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error(`端口 ${port} 拒绝访问，请检查 token 是否配置正确`);
      }
      throw new Error(await getResponseError(response) ?? `端口 ${port} 返回 HTTP ${response.status}`);
    }

    return await response.blob();
  }

  throw new Error(lastError);
}

async function serializeBlob(blob: Blob): Promise<{ mimeType: string; dataBase64: string }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return {
    mimeType: blob.type || 'image/png',
    dataBase64: btoa(binary),
  };
}

export default defineBackground(() => {
  chrome.runtime.onMessage.addListener(
    (
      message: JdExtractedMessage | ResumeImageRequestedMessage,
      _sender,
      sendResponse: (response: PostResult | ResumeImageResult) => void,
    ) => {
      if (message?.type === 'JD_EXTRACTED') {
        postToLocalApp(message.payload).then(sendResponse);
        return true;
      }

      if (message?.type === 'RESUME_IMAGE_REQUESTED') {
        fetchResumeImage(message.jobId)
          .then(serializeBlob)
          .then((result) => sendResponse({ ok: true, ...result }))
          .catch((error) => sendResponse({
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          }));
        return true;
      }

      return undefined;
    },
  );
});

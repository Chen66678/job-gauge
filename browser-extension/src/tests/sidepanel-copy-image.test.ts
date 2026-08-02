import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';

const storageData: Record<string, unknown> = {};
let clipboardWriteMock: ReturnType<typeof vi.fn>;
let sendMessageMock: ReturnType<typeof vi.fn>;

vi.mock('../../entrypoints/shared/collectionState', () => ({
  AUTO_COLLECT_ENABLED_KEY: 'autoCollectEnabled',
  COLLECTION_RECORDS_KEY: 'collectionRecords',
  DETAIL_PANEL_STATUS_KEY: 'detailPanelStatus',
  CURRENT_VIEWED_JOB_ID_KEY: 'currentViewedJobId',
  COLLECTED_JOB_IDS_KEY: 'collectedJobIds',
  SESSION_COLLECTED_JOB_COUNT_KEY: 'sessionCollectedJobCount',
  parseCollectionRecords: (value: unknown) => Array.isArray(value) ? value : [],
  resetSessionCollectedCount: vi.fn(),
}));

async function setupDom() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <input id="auto-collect-toggle" type="checkbox" />
    <span id="toggle-state"></span>
    <span id="collected-count"></span>
    <div id="records"></div>
    <div id="empty-state"></div>
    <div id="panel-status"></div>
    <button id="copy-image-button" type="button"></button>
    <div id="copy-image-status"></div>
  </body></html>`, { url: 'http://localhost' });

  const { window } = dom;
  Object.assign(globalThis, {
    window,
    document: window.document,
    navigator: window.navigator,
    ClipboardItem: class ClipboardItem {
      items: Record<string, Blob>;
      constructor(items: Record<string, Blob>) {
        this.items = items;
      }
    },
  });

  clipboardWriteMock = vi.fn().mockResolvedValue(undefined);
  (window.navigator as unknown as { clipboard: { write: typeof clipboardWriteMock } }).clipboard = {
    write: clipboardWriteMock,
  };

  vi.stubGlobal('chrome', {
    storage: {
      local: {
        get: vi.fn(async (keys: string[]) => {
          const result: Record<string, unknown> = {};
          for (const key of keys) result[key] = storageData[key];
          return result;
        }),
        set: vi.fn(async (next: Record<string, unknown>) => {
          Object.assign(storageData, next);
        }),
      },
      onChanged: { addListener: vi.fn() },
    },
    runtime: {
      onMessage: { addListener: vi.fn() },
      sendMessage: sendMessageMock,
    },
  } as unknown as typeof chrome);
}

beforeEach(async () => {
  vi.resetModules();
  Object.keys(storageData).forEach((key) => delete storageData[key]);
  sendMessageMock = vi.fn();
  await setupDom();
  storageData.collectionRecords = [{ attemptedAt: '2026-07-31T00:00:00.000Z', title: '岗位 A', result: 'success', jobId: 'job-123' }];
  await import('../../entrypoints/sidepanel/main');
  await Promise.resolve();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sidepanel copy image', () => {
  it('writes the fetched PNG blob to clipboard', async () => {
    const button = document.getElementById('copy-image-button') as HTMLButtonElement;
    const png = new Blob(['png-bytes'], { type: 'image/png' });
    sendMessageMock.mockResolvedValue({
      ok: true,
      mimeType: png.type,
      dataBase64: 'cG5nLWJ5dGVz',
    });

    button.dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(sendMessageMock).toHaveBeenCalledWith({
      type: 'RESUME_IMAGE_REQUESTED',
      jobId: 'job-123',
    });
    expect(clipboardWriteMock).toHaveBeenCalledTimes(1);
    const item = clipboardWriteMock.mock.calls[0][0][0] as { items: Record<string, Blob> };
    expect(item.items['image/png']).not.toBe(png);
    expect(await item.items['image/png'].text()).toBe('png-bytes');
    expect((document.getElementById('copy-image-status') as HTMLDivElement).textContent).toContain('已复制简历图片到剪贴板');
  });

  it('shows a visible failure when fetch fails', async () => {
    const button = document.getElementById('copy-image-button') as HTMLButtonElement;
    sendMessageMock.mockResolvedValue({ ok: false, error: 'bad token' });
    const statusEl = document.getElementById('copy-image-status') as HTMLDivElement;

    button.dispatchEvent(new window.Event('click'));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(statusEl.textContent).toContain('复制失败：bad token');
  });
});

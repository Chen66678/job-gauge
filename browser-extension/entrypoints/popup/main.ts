// Popup UI logic.
//
// Read-only: this only queries tab state and asks the content script to
// extract text. It never injects code that clicks/submits/navigates.

const JOB_DETAIL_PATTERN =
  /^https:\/\/www\.zhipin\.com\/(job_detail\/|web\/geek\/jobs|web\/geek\/job-recommend)/;

type PostResult = { ok: true } | { ok: false; error: string };

const messageEl = document.getElementById('message') as HTMLParagraphElement;
const sendBtn = document.getElementById('send-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

function setStatus(text: string, kind: 'idle' | 'success' | 'error' = 'idle') {
  statusEl.textContent = text;
  statusEl.className = kind === 'idle' ? '' : kind;
}

async function getActiveTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function init() {
  const tab = await getActiveTab();
  const url = tab?.url ?? '';

  if (!tab?.id || !JOB_DETAIL_PATTERN.test(url)) {
    messageEl.textContent = '请在 BOSS 直聘岗位详情页或推荐页使用';
    sendBtn.style.display = 'none';
    return;
  }

  messageEl.textContent = '请先在左侧点选一个岗位，再点击下方按钮采集';
  sendBtn.style.display = 'block';

  sendBtn.addEventListener('click', async () => {
    sendBtn.disabled = true;
    setStatus('提取中...');

    try {
      const result = (await chrome.tabs.sendMessage(tab.id as number, {
        type: 'REQUEST_EXTRACT',
      })) as PostResult;

      if (result.ok) {
        setStatus('已发送 ✓', 'success');
      } else {
        setStatus(`失败: ${result.error}`, 'error');
      }
    } catch (err) {
      setStatus(
        `失败: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    } finally {
      sendBtn.disabled = false;
    }
  });
}

init();

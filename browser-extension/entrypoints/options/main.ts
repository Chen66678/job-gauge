// Options page: persist the local-app pairing token via chrome.storage so
// background.ts can attach it as X-Radar-Token on every /api/jobs request.

import { LOCAL_API_TOKEN_STORAGE_KEY } from '../shared/localApiToken';

const tokenInput = document.getElementById('token-input') as HTMLInputElement;
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement;
const statusEl = document.getElementById('status') as HTMLDivElement;

async function loadToken() {
  const stored = await chrome.storage.local.get(LOCAL_API_TOKEN_STORAGE_KEY);
  const token = stored[LOCAL_API_TOKEN_STORAGE_KEY];
  if (typeof token === 'string') {
    tokenInput.value = token;
  }
}

saveBtn.addEventListener('click', async () => {
  const token = tokenInput.value.trim();
  await chrome.storage.local.set({ [LOCAL_API_TOKEN_STORAGE_KEY]: token });
  statusEl.textContent = '已保存';
  statusEl.className = 'success';
});

void loadToken();

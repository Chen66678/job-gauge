// Content script for BOSS Zhipin job detail pages.
//
// READ-ONLY CONTRACT: this script only reads DOM text content. It never
// clicks, submits, focuses, navigates, or otherwise mutates page state.
//
// Selector notes (see final report for verification caveats): BOSS Zhipin's
// markup changes between deployments and is behind an anti-bot wall that
// blocked automated verification in this environment. Each field below tries
// several known/likely selectors in order and falls back gracefully so the
// extension degrades instead of throwing when the DOM doesn't match.

export interface JdPayload {
  title: string;
  company: string;
  description: string;
  workAddress: string | null;
  sourceUrl: string | null;
}

type ExtractRequest = { type: 'REQUEST_EXTRACT' };
type BackgroundResult = { ok: true } | { ok: false; error: string };

function firstMatch(selectors: string[]): Element | null {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.textContent && el.textContent.trim().length > 0) {
      return el;
    }
  }
  return null;
}

function text(el: Element | null): string {
  return el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function extractWorkAddress(): string | null {
  // District-level (most specific) address block, e.g. the map/address panel
  // on the job detail page. Tried first since it's the preferred granularity.
  const districtEl = firstMatch([
    '.job-address .location-address',
    '.location-address',
    '.job-detail-address',
    '.job-address-text',
  ]);
  const districtText = text(districtEl);
  if (districtText) {
    return districtText;
  }

  // City-level fallback, e.g. the city tag shown next to the job title.
  const cityEl = firstMatch(['.job-area', '.job-city', '.name .job-area']);
  const cityText = text(cityEl);
  return cityText || null;
}

function extractJd(): JdPayload {
  const titleEl = firstMatch(['.job-name', 'h1.name', '.job-title h1']);
  const companyEl = firstMatch([
    '.company-name',
    'a.company-name',
    '.job-detail-header .company-name',
  ]);
  const descriptionEl = firstMatch([
    '.job-detail-body',
    '.job-sec-text',
    '.job-sec .text',
    '.job-detail-section .text',
  ]);

  return {
    title: text(titleEl) || document.title.trim(),
    company: text(companyEl),
    description: text(descriptionEl),
    workAddress: extractWorkAddress(),
    sourceUrl: location.href,
  };
}

export default defineContentScript({
  matches: ['https://www.zhipin.com/job_detail/*'],
  main() {
    chrome.runtime.onMessage.addListener(
      (
        message: ExtractRequest,
        _sender,
        sendResponse: (response: BackgroundResult | { ok: false; error: string }) => void,
      ) => {
        if (message?.type !== 'REQUEST_EXTRACT') {
          return undefined;
        }

        const payload = extractJd();

        if (!payload.title && !payload.company && !payload.description) {
          sendResponse({
            ok: false,
            error: '未能在页面中找到岗位信息，选择器可能已失效',
          });
          return true;
        }

        chrome.runtime
          .sendMessage({ type: 'JD_EXTRACTED', payload })
          .then((result: BackgroundResult) => sendResponse(result))
          .catch((err: unknown) =>
            sendResponse({
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            }),
          );

        // Indicate we'll respond asynchronously.
        return true;
      },
    );
  },
});

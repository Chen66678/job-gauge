// Content script for BOSS Zhipin job pages.
//
// READ-ONLY CONTRACT: this script only reads DOM text content. It never
// clicks, submits, focuses, navigates, or otherwise mutates page state. The
// two-column recommendation page (`/web/geek/jobs`) renders the right-hand
// job detail panel only after the user clicks a card in the left-hand list
// themselves; this script never simulates that click, it only reads the
// panel once the user (via the popup) asks it to.
//
// Selector notes: BOSS Zhipin's markup changes between deployments and
// injects hidden noise text (zero-size spans plus a matching inline
// <style>) into the description to poison naive scrapers. Each field below
// tries several known/likely selectors in order (most specific first) and
// falls back gracefully so the extension degrades instead of throwing when
// the DOM doesn't match. Selectors scoped under `.job-detail-container`
// target the two-column recommendation page; unscoped selectors are legacy
// fallbacks for the standalone `/job_detail/*` page.

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

// BOSS Zhipin pads job descriptions with zero-size/hidden spans (each paired
// with an inline <style> rule) to poison text scraped via plain
// textContent. Walk the tree and skip any node CSS-hides or shrinks to
// near-nothing, so only what a human would actually see is collected.
function isNoiseNode(el: Element): boolean {
  if (el.tagName === 'STYLE' || el.tagName === 'SCRIPT') {
    return true;
  }
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') {
    return true;
  }
  const width = parseFloat(style.width);
  const height = parseFloat(style.height);
  if (!isNaN(width) && !isNaN(height) && width <= 1 && height <= 1 && style.overflow === 'hidden') {
    return true;
  }
  return false;
}

function visibleText(el: Element | null): string {
  if (!el) {
    return '';
  }
  let result = '';
  function walk(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      result += node.textContent ?? '';
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }
    if (isNoiseNode(node as Element)) {
      return;
    }
    for (const child of Array.from(node.childNodes)) {
      walk(child);
    }
  }
  walk(el);
  return result.replace(/\s+/g, ' ').trim();
}

function extractCompany(): string {
  // Two-column recommendation page: "<company name> · 招聘者".
  const attrEl = document.querySelector('.job-detail-container .boss-info-attr');
  const attrText = text(attrEl);
  if (attrText) {
    // Strip the trailing "· <recruiter title>" segment (e.g. "· 招聘者",
    // "· 人事经理", "· HRBP") so only the company name remains.
    return attrText.replace(/\s*·[^·]*$/, '').trim();
  }

  // Legacy standalone job_detail page.
  const legacyEl = firstMatch([
    '.company-name',
    'a.company-name',
    '.job-detail-header .company-name',
  ]);
  return text(legacyEl);
}

function extractWorkAddress(): string | null {
  // Two-column recommendation page: full building-level address text. Uses
  // visibleText (not text) because some job cards inject hidden
  // dash-joined address-breadcrumb noise into this element, same anti-
  // scrape pattern as the description field.
  const recommendEl = document.querySelector('.job-detail-container .job-address-desc');
  const recommendText = visibleText(recommendEl);
  if (recommendText) {
    return recommendText;
  }

  // Legacy district-level address block on the standalone job_detail page.
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

function extractSourceUrl(): string | null {
  // Two-column recommendation page: the detail panel's permalink to the
  // standalone job_detail page for the job currently shown on the right.
  // The page URL itself (`/web/geek/jobs`) never changes as the user clicks
  // different cards, so it cannot be used for per-job dedup/back-navigation.
  const permalink = document.querySelector('.job-detail-container a.more-job-btn');
  const href = permalink?.getAttribute('href');
  if (href) {
    return new URL(href, location.origin).toString();
  }

  // Legacy standalone job_detail page: the page URL itself is the job.
  if (/\/job_detail\//.test(location.pathname)) {
    return location.href;
  }

  return null;
}

function extractJd(): JdPayload {
  const titleEl = firstMatch([
    '.job-detail-container .job-name',
    '.job-title h1',
    'h1.name',
    '.job-name',
  ]);
  const descriptionEl = firstMatch([
    '.job-detail-container p.desc',
    '.job-detail-body',
    '.job-sec-text',
    '.job-sec .text',
    '.job-detail-section .text',
  ]);

  return {
    title: text(titleEl) || document.title.trim(),
    company: extractCompany(),
    description: visibleText(descriptionEl),
    workAddress: extractWorkAddress(),
    sourceUrl: extractSourceUrl(),
  };
}

// Guards against reading the right-hand detail panel mid-render right after
// the user clicks a different card in the left-hand list: polls the title
// text until it reads the same value twice in a row (i.e. stopped changing)
// before extracting, instead of trusting whatever is on screen at the exact
// instant REQUEST_EXTRACT arrives. Always resolves, even if content never
// stabilizes, so a slow/odd render can't hang extraction forever.
function waitForStableDetail(): Promise<void> {
  const POLL_INTERVAL_MS = 80;
  const MAX_WAIT_MS = 1500;

  return new Promise((resolve) => {
    const start = Date.now();
    let previous = text(document.querySelector('.job-detail-container .job-name'));

    const tick = () => {
      const current = text(document.querySelector('.job-detail-container .job-name'));
      if (current === previous || Date.now() - start >= MAX_WAIT_MS) {
        resolve();
        return;
      }
      previous = current;
      setTimeout(tick, POLL_INTERVAL_MS);
    };

    setTimeout(tick, POLL_INTERVAL_MS);
  });
}

export default defineContentScript({
  matches: [
    'https://www.zhipin.com/web/geek/jobs*',
    'https://www.zhipin.com/web/geek/job-recommend*',
    'https://www.zhipin.com/job_detail/*',
  ],
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

        waitForStableDetail().then(() => {
          const payload = extractJd();

          if (!payload.title && !payload.company && !payload.description) {
            sendResponse({
              ok: false,
              error: '未能在页面中找到岗位信息，选择器可能已失效',
            });
            return;
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
        });

        // Indicate we'll respond asynchronously.
        return true;
      },
    );
  },
});

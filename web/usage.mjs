// A seven-day operation-count experiment. Only these labels leave the tab.
export const usageEvents = new Set([
  'builder-open', 'builder-import', 'builder-import-error', 'builder-ready', 'builder-preparation-needed',
  'builder-case-reused', 'download-case', 'download-draft', 'download-editor',
  'download-ci', 'download-bundle', 'download-workflow',
  'inspect-open', 'inspect-import', 'inspect-ready', 'inspect-incomplete', 'download-report',
]);
const endpoint = 'https://favour-maui-bag-portrait.trycloudflare.com/event';
const sent = new Set();
let session;

export function usage(event, source) {
  // Local builds, test sessions and opt-outs keep the normal local-only path.
  if (globalThis.location?.origin !== 'https://blucca.github.io' ||
      new URLSearchParams(location.search).get('usage') === 'off' ||
      navigator.globalPrivacyControl || navigator.doNotTrack === '1' ||
      !usageEvents.has(event) || !['page', 'example', 'import'].includes(source)) return;
  const key = `${source}/${event}`;
  if (sent.has(key)) return;
  sent.add(key);
  try {
    session ??= crypto.randomUUID(); // Memory only: a reload starts a new session.
    fetch(endpoint, { method: 'POST', body: JSON.stringify({ event, source, session }),
      credentials: 'omit', referrerPolicy: 'no-referrer', keepalive: true }).catch(() => {});
  } catch { /* Operation counts never interrupt a local check or download. */ }
}

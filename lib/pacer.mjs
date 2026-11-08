// Keeps the whole run inside the site's AI limit (30 requests per 10 minutes per visitor) by waiting when needed,
// so a complete test never gets cut short by rate limiting. Also used to wait out the site's "resting" period after a failure.
import { sleep } from "./util.mjs";

export function makePacer(R, state, { limit = 30, windowMs = 600000, margin = 4, restWaitMs = 65000 } = {}) {
  const times = [];
  const prune = () => { const now = Date.now(); while (times.length && now - times[0] > windowMs) times.shift(); };
  const wait = async (ms, text) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { R.status(`${text} (${Math.ceil((end - Date.now()) / 1000)}s)`); await sleep(Math.min(1000, Math.max(0, end - Date.now()))); }
    R.status("");
  };
  return {
    restWaitMs, windowMs,
    note() { times.push(Date.now()); state.aiCalls++; },
    async pace() {
      prune();
      if (times.length >= limit - margin) {
        await wait(Math.max(0, times[0] + windowMs - Date.now()) + 1500, "Waiting for the site's AI limit to reset so the test is not cut short");
        prune();
      }
    },
    reset() { times.length = 0; },
    wait,
  };
}

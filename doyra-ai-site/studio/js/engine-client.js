// Which AI engine processes uploads: the laptop server (tools/server/app.py,
// full pipeline incl. Demucs exact drums) when it is running and serving this
// page, otherwise the browser.
// Add ?engine=browser to the address to force the browser engine (for comparing).
export async function detectEngine() {
  if (new URLSearchParams(location.search).get('engine') === 'browser') return { kind: 'browser', demucs: false };
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 1500);
    const r = await fetch('/api/health', { signal: ctl.signal, cache: 'no-store' });
    clearTimeout(timer);
    if (!r.ok) throw new Error();
    const h = await r.json();
    return { kind: 'full', demucs: !!h.demucs };
  } catch (e) {
    return { kind: 'browser', demucs: false };
  }
}

// Send a file to the laptop server. onUpdate(stage, result, seconds) is called
// as the job moves on; it resolves with the final result.
export async function processOnServer(file, onUpdate) {
  const form = new FormData();
  form.append('file', file, file.name);
  const r = await fetch('/api/process', { method: 'POST', body: form });
  if (!r.ok) throw new Error(`server: ${r.status}`);
  const { job } = await r.json();
  let lastStage = '';
  for (;;) {
    await new Promise((res) => setTimeout(res, 1000));
    const s = await (await fetch(`/api/jobs/${job}`, { cache: 'no-store' })).json();
    if (s.stage !== lastStage || s.stage === 'separating drums') await onUpdate(s.stage, s.result, s.seconds);
    lastStage = s.stage;
    if (s.stage === 'done') return s.result;
    if (s.stage === 'failed') throw new Error(s.error || 'processing failed');
  }
}

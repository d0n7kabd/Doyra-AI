import { analyzeSong } from './analysis.js';

self.onmessage = (e) => {
  try {
    const result = analyzeSong(e.data.pcm);
    self.postMessage({ result });
  } catch (err) {
    self.postMessage({ error: String(err && err.message || err) });
  }
};

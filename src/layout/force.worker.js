// Physics never blocks the frame: the force galaxy is solved off the main thread.
import { runForce } from './forceSim.js';

self.onmessage = (e) => {
  const { jobId, input } = e.data;
  try {
    self.postMessage({ jobId, result: runForce(input) });
  } catch (err) {
    self.postMessage({ jobId, error: String(err?.message || err) });
  }
};

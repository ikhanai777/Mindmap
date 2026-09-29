import { radialSphere, coneTree, flat2D, forceInput } from './solvers.js';

let worker = null;
let jobSeq = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./force.worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => {
    const { jobId, result, error } = e.data;
    const p = pending.get(jobId);
    if (!p) return;
    pending.delete(jobId);
    if (error) p.reject(new Error(error));
    else p.resolve(new Map(result));
  };
  return worker;
}

/**
 * Compute target positions for the doc's layout mode.
 * @param seed current positions (used to warm-start the force simulation)
 * @returns Promise<Map<id, [x,y,z]>>
 */
export async function computeLayout(doc, seed) {
  switch (doc.layoutMode) {
    case 'cone-tree': return coneTree(doc);
    case 'flat-2d': return flat2D(doc);
    case 'force-galaxy': {
      const input = forceInput(doc, seed);
      if (typeof Worker === 'undefined') {
        const { runForce } = await import('./forceSim.js');
        return new Map(runForce(input));
      }
      const jobId = ++jobSeq;
      return new Promise((resolve, reject) => {
        pending.set(jobId, { resolve, reject });
        getWorker().postMessage({ jobId, input });
      });
    }
    default: return radialSphere(doc);
  }
}

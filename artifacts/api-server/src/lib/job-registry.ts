const activeJobAborts = new Map<number, AbortController>();

export function registerJobAbort(jobId: number): AbortController {
  const prev = activeJobAborts.get(jobId);
  if (prev && !prev.signal.aborted) {
    prev.abort(new Error("Superseded by new run"));
  }
  const controller = new AbortController();
  activeJobAborts.set(jobId, controller);
  return controller;
}

export function clearJobAbort(jobId: number, controller?: AbortController): void {
  if (!controller || activeJobAborts.get(jobId) === controller) {
    activeJobAborts.delete(jobId);
  }
}

export function abortActiveJob(jobId: number, reason = "Stopped by user"): boolean {
  const controller = activeJobAborts.get(jobId);
  if (controller && !controller.signal.aborted) {
    controller.abort(new Error(reason));
    activeJobAborts.delete(jobId);
    return true;
  }
  return false;
}

export function isJobAbortedError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return /aborted|cancelled by user|stopped by user/i.test(msg);
}

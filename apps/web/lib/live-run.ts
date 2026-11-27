"use client";

import type { CompareRequestInput } from "@fomo/shared";
import { fetchJson, ProblemError, streamCompare } from "./api-client";
import { compareReducer, initialCompareState, type CompareState } from "./compare-state";

/**
 * Compares that are streaming in this browser tab.
 *
 * The Compare page starts the stream and moves to the run page as soon as the
 * server has saved the comparison. The stream lives here, outside React, so
 * that page change does not cut it off. The run page reads from here while a
 * run is live, and from the API otherwise (an old run, or after a refresh).
 */
export interface LiveRun {
  id: string;
  request: CompareRequestInput;
  state: CompareState;
  stop: () => void;
}

const runs = new Map<string, LiveRun>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

export function subscribeLiveRuns(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getLiveRun(id: string): LiveRun | undefined {
  return runs.get(id);
}

/**
 * Starts a compare. Resolves with its id once the server has saved it, so the
 * caller can navigate; rejects if the request is refused before that (e.g.
 * validation), so the form can show the error.
 *
 * If the connection drops (tab closed, network blip), the compare keeps running
 * on the server; the run page then reads the saved run and polls until it ends.
 */
export function startLiveRun(request: CompareRequestInput): Promise<string> {
  const controller = new AbortController();
  let run: LiveRun | undefined;
  let state = compareReducer(initialCompareState, {
    type: "start",
    models: request.models,
    judge: request.judge?.enabled ?? true,
    synthesize: request.synthesize ?? false,
  });
  const update = (next: CompareState) => {
    state = next;
    if (run) {
      // A new object, so React's useSyncExternalStore sees the change.
      run = { ...run, state };
      runs.set(run.id, run);
      notify();
    }
  };

  return new Promise<string>((resolve, reject) => {
    streamCompare(
      request,
      (event) => {
        if (event.type === "comparison.started") {
          const id = event.comparisonId;
          // Stop is a request to the server: closing the stream alone no longer cancels a compare.
          const stop = () => {
            void fetchJson(`/api/compare/${encodeURIComponent(id)}/cancel`, { method: "POST" }).catch(() => undefined);
          };
          run = { id, request, state, stop };
          runs.set(run.id, run);
          resolve(run.id);
        }
        update(compareReducer(state, { type: "event", event }));
      },
      controller.signal,
    )
      .catch((error: unknown) => {
        if (!run) return reject(error);
        if (error instanceof ProblemError) {
          update(compareReducer(state, { type: "error", problem: error.problem }));
        } else {
          // The stream broke, but the compare is still running on the server: hand over to the saved run.
          runs.delete(run.id);
          notify();
        }
      })
      // A stream that ends without "comparison.started" never resolved: say so instead of hanging.
      .finally(() => {
        if (!run) reject(new Error("The server closed the stream before the run started."));
      });
  });
}

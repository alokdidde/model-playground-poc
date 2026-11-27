"use client";

import type { CompareRequestInput } from "@fomo/shared";
import { ProblemError, streamCompare } from "./api-client";
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
          run = { id: event.comparisonId, request, state, stop: () => controller.abort() };
          runs.set(run.id, run);
          resolve(run.id);
        }
        update(compareReducer(state, { type: "event", event }));
      },
      controller.signal,
    )
      .catch((error: unknown) => {
        if (!run) return reject(error);
        if (controller.signal.aborted) {
          update(compareReducer(state, { type: "event", event: { type: "comparison.completed", comparisonId: run.id, status: "CANCELLED" } }));
        } else {
          const problem = error instanceof ProblemError ? error.problem : { type: "about:blank", title: "Connection lost", status: 0, detail: String(error) };
          update(compareReducer(state, { type: "error", problem }));
        }
      })
      // A stream that ends without "comparison.started" never resolved: say so instead of hanging.
      .finally(() => {
        if (!run) reject(new Error("The server closed the stream before the run started."));
      });
  });
}

/**
 * Durable workflows for batch evals (DBOS).
 *
 * A workflow is ordinary async code. DBOS checkpoints the result of each
 * step (and each child workflow) in Postgres, so if the worker crashes or is
 * redeployed mid-run, a new worker resumes the workflow from the last
 * completed step instead of starting over (and re-paying for model calls).
 *
 * Shape of a run (each level is a queue, so each has its own flow control):
 *
 *   evalRunWorkflow(run)                          queue: eval-runs
 *     └─ evalPromptWorkflow(run, prompt i)        queue: eval-prompts
 *          ├─ modelCallWorkflow(run, i, model)    queue: model-calls (rate limited)
 *          └─ step: judge prompt i
 *
 * Child workflow ids are derived from the run id, so a replay finds the
 * existing children instead of enqueueing duplicates.
 */
import { DBOS } from "@dbos-inc/dbos-sdk";
import { QUEUES, WORKFLOWS } from "@fomo/shared";
import {
  callModel,
  finalizeRun,
  judgePrompt,
  loadPromptContext,
  markRunFailed,
  markRunStarted,
  type ModelCallOutcome,
} from "./activities";

/**
 * Our gateway already retries model calls (with jitter and the shared rate
 * limiter), so DBOS-level step retries cover only infrastructure blips such
 * as a dropped database connection.
 */
const STEP_RETRY = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 2, backoffRate: 2 };

async function modelCall(runId: string, promptIndex: number, model: string): Promise<ModelCallOutcome> {
  return DBOS.runStep(() => callModel(runId, promptIndex, model), { name: "callModel", ...STEP_RETRY });
}
export const modelCallWorkflow = DBOS.registerWorkflow(modelCall, { name: WORKFLOWS.modelCall });

async function evalPrompt(runId: string, promptIndex: number): Promise<void> {
  const ctx = await DBOS.runStep(() => loadPromptContext(runId, promptIndex), { name: "loadPrompt", ...STEP_RETRY });

  const handles = [];
  for (const model of ctx.models) {
    handles.push(
      await DBOS.startWorkflow(modelCallWorkflow, {
        queueName: QUEUES.modelCalls,
        workflowID: `${runId}:p${promptIndex}:${model}`,
      })(runId, promptIndex, model),
    );
  }
  // Await in a fixed order so the workflow is deterministic on replay.
  const outcomes: ModelCallOutcome[] = [];
  for (const handle of handles) outcomes.push(await handle.getResult());

  await DBOS.runStep(() => judgePrompt(runId, promptIndex, outcomes), { name: "judgePrompt", ...STEP_RETRY });
}
export const evalPromptWorkflow = DBOS.registerWorkflow(evalPrompt, { name: WORKFLOWS.evalPrompt });

async function evalRun(runId: string): Promise<void> {
  try {
    const { promptCount } = await DBOS.runStep(() => markRunStarted(runId), { name: "markRunStarted", ...STEP_RETRY });

    const handles = [];
    for (let i = 0; i < promptCount; i++) {
      handles.push(
        await DBOS.startWorkflow(evalPromptWorkflow, { queueName: QUEUES.evalPrompts, workflowID: `${runId}:p${i}` })(runId, i),
      );
    }
    for (const handle of handles) await handle.getResult();

    await DBOS.runStep(() => finalizeRun(runId), { name: "finalizeRun", ...STEP_RETRY });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await DBOS.runStep(() => markRunFailed(runId, message), { name: "markRunFailed", ...STEP_RETRY });
    throw error;
  }
}
export const evalRunWorkflow = DBOS.registerWorkflow(evalRun, { name: WORKFLOWS.evalRun });

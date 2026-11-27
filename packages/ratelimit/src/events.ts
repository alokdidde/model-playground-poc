import type { PrismaClient } from "@fomo/db";
import { Prisma } from "@fomo/db";

/**
 * Rate-limit observability: every decision the limiter and the gateway make
 * becomes one event, so a run can be replayed as a timeline afterwards.
 *
 *   lease_granted   a call got capacity. ms = how long it waited in total.
 *                   data = bucket levels (used / effective limit) and the AIMD factor
 *   lease_wait      no capacity yet. ms = how long we sleep before asking again
 *   lease_timeout   gave up waiting (the caller's maxWaitMs ran out)
 *   lease_released  a call finished. data = tokens reserved vs actually used
 *   rate_limited    the provider answered 429. data = its headers (remaining, reset)
 *   cooldown        the bucket is blocked for everyone. ms = how long
 *   limits_learned  the provider's headers changed what we think the limits are
 *   factor_changed  the AIMD factor moved (halved on a 429, crept back on success)
 *   retry           the gateway will retry. ms = the delay actually used,
 *                   data = how it was made (backoff ceiling, jitter, Retry-After)
 *   attempt_ok      one attempt succeeded. ms = its latency
 *   attempt_failed  one attempt failed. ms = how long it ran, data.kind = why
 *
 * Emitting never throws and never waits on the database: a broken sink must
 * not slow down or fail a model call.
 */
export type RateEventKind =
  | "lease_granted"
  | "lease_wait"
  | "lease_timeout"
  | "lease_released"
  | "rate_limited"
  | "cooldown"
  | "limits_learned"
  | "factor_changed"
  | "retry"
  | "attempt_ok"
  | "attempt_failed";

export interface RateEvent {
  kind: RateEventKind;
  model?: string;
  /** The comparison this call belongs to, so a timeline can be filtered by run. */
  tag?: string;
  attempt?: number;
  ms?: number;
  data?: Record<string, unknown>;
}

export interface RateEventSink {
  emit(event: RateEvent): void;
  /** Writes anything buffered. Call before a short-lived process exits. */
  flush?(): Promise<void>;
}

export const noopSink: RateEventSink = { emit() {} };

/** Keeps events in memory. For tests. */
export class MemoryEventSink implements RateEventSink {
  readonly events: (RateEvent & { at: number })[] = [];
  emit(event: RateEvent) {
    this.events.push({ ...event, at: Date.now() });
  }
  ofKind(kind: RateEventKind) {
    return this.events.filter((e) => e.kind === kind);
  }
}

/**
 * Buffers events and writes them to the rate_event table once a second with
 * one INSERT, so even a burst of compares adds only one small write per second.
 * Old rows are pruned now and then (RETENTION_DAYS).
 */
export class PostgresEventSink implements RateEventSink {
  private buffer: Prisma.RateEventCreateManyInput[] = [];
  private readonly timer: NodeJS.Timeout;
  private flushes = 0;

  static readonly FLUSH_MS = 1_000;
  /** Drop events if the database is unreachable for a long time, rather than grow without bound. */
  static readonly MAX_BUFFER = 10_000;
  static readonly RETENTION_DAYS = 7;

  constructor(
    private readonly prisma: PrismaClient,
    /** Which process this is: "web" or "script". */
    private readonly source: string,
  ) {
    this.timer = setInterval(() => void this.flush(), PostgresEventSink.FLUSH_MS);
    this.timer.unref(); // never keeps a process alive on its own
  }

  emit(event: RateEvent): void {
    if (this.buffer.length >= PostgresEventSink.MAX_BUFFER) return;
    this.buffer.push({
      at: new Date(),
      source: this.source,
      kind: event.kind,
      model: event.model,
      tag: event.tag,
      attempt: event.attempt,
      ms: event.ms === undefined ? undefined : Math.round(event.ms),
      data: (event.data as Prisma.InputJsonValue | undefined) ?? Prisma.DbNull,
    });
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.prisma.rateEvent.createMany({ data: batch });
      if (++this.flushes % 600 === 0) {
        await this.prisma.$executeRaw`
          DELETE FROM rate_event WHERE at < now() - ${PostgresEventSink.RETENTION_DAYS}::int * interval '1 day'`;
      }
    } catch (error) {
      console.warn("[rate-events] could not write events; dropped", batch.length, error);
    }
  }
}

/** RATE_EVENTS=off disables recording (it is on by default). */
export function eventSinkFromEnv(prisma: PrismaClient, source: string): RateEventSink {
  if (process.env.RATE_EVENTS === "off") return noopSink;
  return new PostgresEventSink(prisma, source);
}

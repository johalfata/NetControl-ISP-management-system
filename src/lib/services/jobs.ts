import { prisma, type Tx } from "../db";
import { JobStatus, JobTrigger, type JobRun } from "@prisma/client";

export type RunJobOptions = {
  idempotencyKey?: string;
  trigger?: JobTrigger;
  actorLabel?: string;
};

export async function runJob(
  jobName: string,
  fn: (runId: string) => Promise<{ itemsProcessed?: number; result?: unknown }>,
  options: RunJobOptions = {},
  client: Tx | typeof prisma = prisma,
): Promise<JobRun> {
  if (options.idempotencyKey) {
    const existing = await client.jobRun.findUnique({
      where: { idempotencyKey: options.idempotencyKey },
    });
    if (existing) {
      return existing;
    }
  }

  // Concurrency protection: check if jobName is already running
  const running = await client.jobRun.findFirst({
    where: {
      jobName,
      status: JobStatus.RUNNING,
    },
  });
  if (running) {
    const skippedRun = await client.jobRun.create({
      data: {
        jobName,
        trigger: options.trigger ?? JobTrigger.SCHEDULE,
        status: JobStatus.SKIPPED,
        error: `Job ${jobName} sudah berjalan (concurrency protection)`,
        actorLabel: options.actorLabel,
        idempotencyKey: options.idempotencyKey,
      },
    });
    return skippedRun;
  }

  const startedAt = new Date();
  const jobRun = await client.jobRun.create({
    data: {
      jobName,
      trigger: options.trigger ?? JobTrigger.SCHEDULE,
      status: JobStatus.RUNNING,
      actorLabel: options.actorLabel,
      idempotencyKey: options.idempotencyKey,
    },
  });

  try {
    const output = await fn(jobRun.id);
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();

    const updated = await client.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: JobStatus.SUCCESS,
        finishedAt,
        durationMs,
        itemsProcessed: output.itemsProcessed ?? 0,
        result: output.result ? JSON.parse(JSON.stringify(output.result)) : undefined,
      },
    });
    return updated;
  } catch (error) {
    const finishedAt = new Date();
    const durationMs = finishedAt.getTime() - startedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    const updated = await client.jobRun.update({
      where: { id: jobRun.id },
      data: {
        status: JobStatus.FAILED,
        finishedAt,
        durationMs,
        error: errorMessage,
      },
    });
    return updated;
  }
}

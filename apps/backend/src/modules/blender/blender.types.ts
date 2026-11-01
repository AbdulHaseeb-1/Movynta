import type { BLENDER_JOB_STATES } from "./blender-worker.js";

export type BlenderJobState = (typeof BLENDER_JOB_STATES)[number];

/** Job requests name a registered script and its parameters. Raw script text is never accepted. */
export interface BlenderJobRequest {
  readonly scriptId: string;
  readonly parameters: Readonly<Record<string, string | number | boolean>>;
  readonly timeoutMs: number;
}

export interface BlenderJobResult {
  readonly jobId: string;
  readonly state: BlenderJobState;
  readonly outputFiles: readonly string[];
  readonly error: string | undefined;
}

export interface BlenderWorker {
  readonly available: boolean;
  submit(request: BlenderJobRequest): Promise<BlenderJobResult>;
  cancel(jobId: string): Promise<BlenderJobResult>;
}

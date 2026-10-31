/**
 * Optional advanced modeling worker. Blender is never required for the backend
 * to work, and the AI agents never receive a shell or a filesystem handle through it.
 */
export const BLENDER_WORKER = Symbol("BLENDER_WORKER");

export const BLENDER_JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;
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

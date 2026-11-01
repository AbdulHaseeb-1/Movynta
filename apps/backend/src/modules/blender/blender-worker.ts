/**
 * Optional advanced modeling worker. Blender is never required for the backend
 * to work, and the AI agents never receive a shell or a filesystem handle through it.
 */
export const BLENDER_WORKER = Symbol("BLENDER_WORKER");

export const BLENDER_JOB_STATES = ["queued", "running", "succeeded", "failed", "cancelled"] as const;

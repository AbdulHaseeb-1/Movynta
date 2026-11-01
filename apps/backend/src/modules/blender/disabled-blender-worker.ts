import { ServiceUnavailableError } from "../../common/errors/app-error.js";
import type { BlenderJobRequest, BlenderJobResult, BlenderWorker } from "./blender.types.js";

/**
 * Used whenever Blender is not configured or not installed. It reports that the
 * worker is unavailable instead of pretending to run jobs.
 */
export class DisabledBlenderWorker implements BlenderWorker {
  readonly available = false;

  submit(_request: BlenderJobRequest): Promise<BlenderJobResult> {
    return Promise.reject(new ServiceUnavailableError("Blender worker is not available on this server"));
  }

  cancel(_jobId: string): Promise<BlenderJobResult> {
    return Promise.reject(new ServiceUnavailableError("Blender worker is not available on this server"));
  }
}

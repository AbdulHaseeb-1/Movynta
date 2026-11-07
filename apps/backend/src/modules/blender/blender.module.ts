import { Logger, Module } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import { BLENDER_WORKER } from "./blender-worker.js";
import type { BlenderWorker } from "./blender.types.js";
import { DisabledBlenderWorker } from "./disabled-blender-worker.js";

/**
 * Registers the Blender worker. A process-backed implementation is not part of
 * this release, so enabling BLENDER_ENABLED only logs a warning and keeps the
 * worker unavailable.
 */
@Module({
  providers: [
    {
      provide: BLENDER_WORKER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): BlenderWorker => {
        const logger = new Logger("BlenderModule");
        if (config.blender.enabled) {
          logger.warn("BLENDER_ENABLED is set, but no Blender worker is implemented yet; jobs are unavailable");
        }
        return new DisabledBlenderWorker();
      },
    },
  ],
  exports: [BLENDER_WORKER],
/** The Blender worker interface. Its implementation is disabled. */
})
export class BlenderModule {}

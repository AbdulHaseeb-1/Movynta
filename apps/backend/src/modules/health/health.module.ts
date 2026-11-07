import { Module } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

/** The health feature: liveness and readiness checks. */
@Module({ controllers: [HealthController] })
export class HealthModule {}

import { Controller, Get, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from "@nestjs/swagger";
import { Public } from "../../common/decorators/public.decorator.js";
import { ServiceUnavailableError } from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";

@ApiTags("health")
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  /** Liveness: the process is up. Does not touch dependencies. */
  @Public()
  @Get("live")
  @ApiOkResponse({ description: "The process is running." })
  live(): { status: "ok" } {
    return { status: "ok" };
  }

  /** Readiness: local dependencies are usable. */
  @Public()
  @Get("ready")
  @ApiOkResponse({ description: "The service can accept requests." })
  @ApiServiceUnavailableResponse({ description: "A required dependency is unavailable." })
  ready(): { status: "ready"; checks: { database: "ok" } } {
    if (!this.database.ping()) throw new ServiceUnavailableError("Database is unavailable");
    return { status: "ready", checks: { database: "ok" } };
  }
}

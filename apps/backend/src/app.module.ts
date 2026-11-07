import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AppExceptionFilter } from "./common/errors/app-exception.filter.js";
import { RateLimitGuard } from "./common/rate-limit/rate-limit.guard.js";
import { RequestIdMiddleware } from "./common/http/request-id.js";
import { AppConfigModule } from "./config/config.module.js";
import { AgentRunsModule } from "./modules/agent-runs/agent-runs.module.js";
import { AgentsModule } from "./modules/agents/agents.module.js";
import { ApprovalsModule } from "./modules/approvals/approvals.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { BlenderModule } from "./modules/blender/blender.module.js";
import { EditorBridgeModule } from "./modules/editor-bridge/editor-bridge.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { McpModule } from "./modules/mcp/mcp.module.js";
import { PersistenceModule } from "./modules/persistence/persistence.module.js";
import { ProjectsModule } from "./modules/projects/projects.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { SkillsModule } from "./modules/skills/skills.module.js";
import { ToolsModule } from "./modules/tools/tools.module.js";
import { ProvidersModule } from "./modules/providers/providers.module.js";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    AppConfigModule,
    PersistenceModule,
    AuthModule,
    HealthModule,
    ProjectsModule,
    SessionsModule,
    SkillsModule,
    ToolsModule,
    ProvidersModule,
    AgentsModule,
    ApprovalsModule,
    EditorBridgeModule,
    AgentRunsModule,
    McpModule,
    BlenderModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_FILTER, useClass: AppExceptionFilter },
  ],
/** The root module. It wires configuration, persistence and every feature module, and sets up the request middleware. */
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes("*");
  }
}

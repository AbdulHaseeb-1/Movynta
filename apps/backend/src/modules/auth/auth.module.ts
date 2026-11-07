import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./auth.guard.js";
import { AuthService } from "./auth.service.js";

@Module({
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [AuthService],
/** Authentication: the bearer-token guard and the signing secret it checks against. */
})
export class AuthModule {}

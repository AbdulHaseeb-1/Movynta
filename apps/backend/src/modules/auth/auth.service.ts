import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG } from "../../config/config.module.js";
import type { AppConfig } from "../../config/config.types.js";
import type { AuthUser } from "./auth.types.js";
import { verifyToken } from "./token.js";

/** Verifies bearer tokens for HTTP and WebSocket clients. */
@Injectable()
export class AuthService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  authenticate(token: string): AuthUser {
    return { id: verifyToken(token, this.config.auth.secret) };
  }
}

import { Controller, Delete, Get, Post } from "@nestjs/common";
import { CurrentUser } from "../../../common/decorators/current-user.decorator.js";
import type { AuthUser } from "../../auth/auth.types.js";
import { ChatgptAuthService } from "./chatgpt-auth.service.js";
import type { ChatgptLoginStart, ChatgptSessionView } from "./chatgpt.types.js";

/**
 * Browser sign-in for a ChatGPT subscription. Signing out is `DELETE /providers/chatgpt`, which
 * removes the provider and its stored sign-in together.
 */
@Controller({ path: "providers/chatgpt", version: "1" })
export class ChatgptAuthController {
  constructor(private readonly chatgpt: ChatgptAuthService) {}

  @Get("session") session(@CurrentUser() user: AuthUser): ChatgptSessionView {
    return this.chatgpt.session(user.id);
  }

  /** Starts a sign-in and returns the page the user must open in a browser. */
  @Post("login") login(@CurrentUser() user: AuthUser): Promise<ChatgptLoginStart> {
    return this.chatgpt.beginLogin(user.id);
  }

  @Delete("login") async cancel(@CurrentUser() user: AuthUser): Promise<ChatgptSessionView> {
    await this.chatgpt.cancelLogin(user.id);
    return this.chatgpt.session(user.id);
  }
}

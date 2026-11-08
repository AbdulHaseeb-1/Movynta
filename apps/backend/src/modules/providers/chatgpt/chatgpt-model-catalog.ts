import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { ServiceUnavailableError } from "../../../common/errors/app-error.js";
import { ChatgptAuthService } from "./chatgpt-auth.service.js";
import {
  CHATGPT_BASE_URL,
  CHATGPT_CATALOG_TTL_MS,
  CHATGPT_CLIENT_VERSION,
  CHATGPT_ORIGINATOR,
  CHATGPT_REQUEST_TIMEOUT_MS,
} from "./chatgpt.constants.js";

const catalogSchema = z.object({
  models: z.array(
    z.object({
      slug: z.string().min(1),
      visibility: z.string().optional(),
      priority: z.number().optional(),
    }),
  ),
});

interface CatalogEntry {
  readonly fetchedAt: number;
  readonly models: readonly string[];
}

/**
 * The models a ChatGPT account may use. They differ by plan and change over time, so they are read
 * from the subscription backend (as the Codex client does) instead of being hard-coded.
 */
@Injectable()
export class ChatgptModelCatalog {
  /** Keyed by ChatGPT account, so another account never sees a cached list. */
  private readonly cache = new Map<string, CatalogEntry>();

  constructor(private readonly auth: ChatgptAuthService) {}

  /** Selectable models, best first. Throws when the backend cannot be reached. */
  async list(userId: string): Promise<readonly string[]> {
    const { accessToken, accountId } = await this.auth.credentials(userId);
    const cached = this.cache.get(accountId);
    if (cached && Date.now() - cached.fetchedAt < CHATGPT_CATALOG_TTL_MS) return cached.models;
    const models = await this.fetchModels(accessToken, accountId);
    this.cache.set(accountId, { fetchedAt: Date.now(), models });
    return models;
  }

  private async fetchModels(accessToken: string, accountId: string): Promise<readonly string[]> {
    let response: Response;
    try {
      response = await fetch(`${CHATGPT_BASE_URL}/models?client_version=${CHATGPT_CLIENT_VERSION}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "chatgpt-account-id": accountId,
          originator: CHATGPT_ORIGINATOR,
          Accept: "application/json",
        },
        redirect: "error",
        signal: AbortSignal.timeout(CHATGPT_REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new ServiceUnavailableError("Could not load ChatGPT models. Check your network and try again.");
    }
    const parsed = response.ok ? catalogSchema.safeParse(await response.json()) : undefined;
    if (!parsed?.success) throw new ServiceUnavailableError("Could not load ChatGPT models. Try signing in again.");
    return parsed.data.models
      .filter((model) => model.visibility === "list")
      .sort((a, b) => (a.priority ?? Infinity) - (b.priority ?? Infinity))
      .map((model) => model.slug);
  }
}

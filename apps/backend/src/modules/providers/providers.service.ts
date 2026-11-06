import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ConflictError,
  NotFoundError,
  ServiceUnavailableError,
} from "../../common/errors/app-error.js";
import { DatabaseService } from "../persistence/database.service.js";
import {
  textColumn,
  integerColumn,
  optionalTextColumn,
} from "../persistence/row.js";
import { ProviderTransport } from "./provider-transport.js";
import { SECRET_PROTECTOR, type SecretProtector } from "./secret-protector.js";
import { CHATGPT_KEY_PLACEHOLDER } from "./chatgpt/chatgpt.constants.js";
import { ChatgptAuthService } from "./chatgpt/chatgpt-auth.service.js";
import { ChatgptModelCatalog } from "./chatgpt/chatgpt-model-catalog.js";
import {
  PROVIDER_IDS,
  isCompatibleProvider,
  isSubscriptionProvider,
  type ProviderId,
  type ProviderView,
  type ProviderCredentials,
} from "./providers.types.js";
import { providerEndpoint } from "./provider-endpoint.js";

@Injectable()
export class ProvidersService {
  private readonly logger = new Logger(ProvidersService.name);

  constructor(
    private readonly database: DatabaseService,
    @Inject(SECRET_PROTECTOR) private readonly vault: SecretProtector,
    private readonly transport: ProviderTransport,
    private readonly chatgpt: ChatgptAuthService,
    private readonly chatgptModels: ChatgptModelCatalog,
  ) {
    // A finished ChatGPT sign-in registers the provider and becomes the active one if none is.
    chatgpt.onConnected(async (userId) => {
      this.ensureSubscriptionRow(userId, "chatgpt");
      try {
        await this.chatgptModel(userId, undefined);
      } catch {
        // The model is chosen again when models are next loaded.
        this.logger.warn("Could not load ChatGPT models after sign-in");
      }
      if (!this.list(userId).some((provider) => provider.active))
        this.activate(userId, "chatgpt");
    });
  }

  list(userId: string): ProviderView[] {
    return PROVIDER_IDS.map((id) => {
      const row = this.database.db
        .prepare(
          "SELECT model, active, base_url, accepts_images FROM model_providers WHERE user_id = ? AND provider_id = ?",
        )
        .get(userId, id);
      // A subscription provider is configured by an unexpired sign-in, not by a saved key.
      const subscription = isSubscriptionProvider(id);
      const configured = subscription
        ? this.chatgpt.isConnected(userId)
        : Boolean(row);
      return {
        id,
        model: row ? textColumn(row, "model") : "",
        configured,
        active: configured && row ? integerColumn(row, "active") === 1 : false,
        baseUrl: row ? (optionalTextColumn(row, "base_url") ?? "") : "",
        acceptsImages: row ? integerColumn(row, "accepts_images") === 1 : true,
      };
    });
  }

  /**
   * Whether pictures may be sent to the model of a provider. Only the compatible endpoints can refuse them,
   * because only they can serve a model that cannot read images.
   */
  picturesAllowed(userId: string, id?: ProviderId): boolean {
    if (id === undefined || !isCompatibleProvider(id)) return true;
    const row = this.database.db
      .prepare(
        "SELECT accepts_images FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .get(userId, id);
    return row ? integerColumn(row, "accepts_images") === 1 : true;
  }

  async save(
    userId: string,
    id: ProviderId,
    model: string,
    apiKey: string | undefined,
    baseUrl?: string,
    acceptsImages?: boolean,
  ): Promise<ProviderView[]> {
    if (isSubscriptionProvider(id)) return this.saveSubscriptionModel(userId, id, model);
    const previous = this.database.db
      .prepare(
        "SELECT encrypted_key, base_url, accepts_images FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .get(userId, id);
    const previousPictures = previous ? integerColumn(previous, "accepts_images") === 1 : true;
    // Native providers always send pictures; a compatible endpoint keeps its setting unless the user changes it.
    const pictures = isCompatibleProvider(id) ? (acceptsImages ?? previousPictures) : true;
    const previousUrl = previous
      ? optionalTextColumn(previous, "base_url")
      : undefined;
    const endpoint = providerEndpoint(id, baseUrl ?? previousUrl);
    if (!apiKey && endpoint !== previousUrl)
      throw new ConflictError(
        "Enter the API key again when changing the provider endpoint",
      );
    const encrypted = apiKey
      ? await this.vault.protect(apiKey, `${userId}:${id}`)
      : previous
        ? textColumn(previous, "encrypted_key")
        : undefined;
    if (!encrypted)
      throw new ConflictError("An API key is required for a new provider");
    this.database.db
      .prepare(
        `INSERT INTO model_providers (user_id, provider_id, model, encrypted_key, active, base_url, accepts_images) VALUES (?, ?, ?, ?, 0, ?, ?) ON CONFLICT(user_id, provider_id) DO UPDATE SET model = excluded.model, encrypted_key = excluded.encrypted_key, base_url = excluded.base_url, accepts_images = excluded.accepts_images`,
      )
      .run(userId, id, model, encrypted, endpoint ?? null, pictures ? 1 : 0);
    if (!this.list(userId).some((provider) => provider.active))
      this.activate(userId, id);
    return this.list(userId);
  }

  /** Changes the default model of a subscription provider; there is no key to store. */
  private saveSubscriptionModel(
    userId: string,
    id: ProviderId,
    model: string,
  ): ProviderView[] {
    if (!this.chatgpt.isConnected(userId))
      throw new ConflictError("Sign in with ChatGPT first");
    this.ensureSubscriptionRow(userId, id, model);
    this.database.db
      .prepare(
        "UPDATE model_providers SET model = ? WHERE user_id = ? AND provider_id = ?",
      )
      .run(model, userId, id);
    return this.list(userId);
  }

  /** Subscription providers keep their model and active flag in the shared table, with no secret in it. */
  private ensureSubscriptionRow(
    userId: string,
    id: ProviderId,
    model = "",
  ): void {
    this.database.db
      .prepare(
        "INSERT OR IGNORE INTO model_providers (user_id, provider_id, model, encrypted_key, active) VALUES (?, ?, ?, ?, 0)",
      )
      .run(userId, id, model, CHATGPT_KEY_PLACEHOLDER);
  }

  activate(userId: string, id: ProviderId): ProviderView[] {
    if (
      !this.list(userId).some(
        (provider) => provider.id === id && provider.configured,
      )
    )
      throw new NotFoundError("Configure this provider first");
    if (isSubscriptionProvider(id)) this.ensureSubscriptionRow(userId, id);
    this.database.transaction((db) => {
      db.prepare("UPDATE model_providers SET active = 0 WHERE user_id = ?").run(
        userId,
      );
      db.prepare(
        "UPDATE model_providers SET active = 1 WHERE user_id = ? AND provider_id = ?",
      ).run(userId, id);
    });
    return this.list(userId);
  }

  async remove(userId: string, id: ProviderId): Promise<ProviderView[]> {
    if (isSubscriptionProvider(id)) await this.chatgpt.disconnect(userId);
    this.database.db
      .prepare(
        "DELETE FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .run(userId, id);
    // Removing the selected provider must not leave the user with none selected while another is configured.
    const remaining = this.list(userId);
    const next = remaining.find((provider) => provider.configured);
    if (next && !remaining.some((provider) => provider.active)) return this.activate(userId, next.id);
    return remaining;
  }

  active(userId: string): ProviderView {
    const provider = this.list(userId).find((item) => item.active);
    if (!provider)
      throw new ServiceUnavailableError(
        "Configure and select a model provider in Settings first",
      );
    return provider;
  }

  configured(userId: string, id: ProviderId): ProviderView {
    const provider = this.list(userId).find((item) => item.id === id && item.configured);
    if (!provider) throw new NotFoundError("The selected provider is not configured");
    return provider;
  }

  async credentials(
    userId: string,
    id: ProviderId,
    model?: string,
    expectedEndpoint?: string,
  ): Promise<ProviderCredentials> {
    if (isSubscriptionProvider(id)) return this.subscriptionCredentials(userId, id, model);
    const row = this.database.db
      .prepare(
        "SELECT model, encrypted_key, base_url FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .get(userId, id);
    if (!row) throw new NotFoundError("Provider is not configured");
    const baseUrl = optionalTextColumn(row, "base_url");
    if (expectedEndpoint !== undefined && expectedEndpoint !== baseUrl)
      throw new ConflictError(
        "The provider endpoint changed during this run. Start a new run.",
      );
    return {
      baseUrl,
      id,
      model: model ?? textColumn(row, "model"),
      apiKey: await this.vault.unprotect(
        textColumn(row, "encrypted_key"),
        `${userId}:${id}`,
      ),
    };
  }

  private async subscriptionCredentials(
    userId: string,
    id: ProviderId,
    model: string | undefined,
  ): Promise<ProviderCredentials> {
    const access = await this.chatgpt.credentials(userId);
    return {
      id,
      model: await this.chatgptModel(userId, model),
      apiKey: access.accessToken,
      accountId: access.accountId,
    };
  }

  /**
   * The model to use on a ChatGPT account. The saved default can be empty or stale (the plan changed,
   * or the list was different when it was saved), so it is replaced by the account's first model.
   * A model the user explicitly picked is passed through, since the catalog omits hidden models.
   */
  private async chatgptModel(
    userId: string,
    requested: string | undefined,
  ): Promise<string> {
    const stored = this.list(userId).find((item) => item.id === "chatgpt")?.model ?? "";
    const wanted = requested || stored;
    const available: readonly string[] = await this.chatgptModels
      .list(userId)
      .catch(() => []);
    const [first] = available;
    if (first === undefined || available.includes(wanted)) return wanted;
    if (requested && requested !== stored) return requested;
    this.saveSubscriptionModel(userId, "chatgpt", first);
    return first;
  }

  async models(
    userId: string,
    id: ProviderId,
    apiKey?: string,
    baseUrl?: string,
  ): Promise<{ models: string[] }> {
    if (isSubscriptionProvider(id)) {
      this.configured(userId, id);
      const models = await this.chatgptModels.list(userId);
      await this.chatgptModel(userId, undefined);
      return { models: [...models] };
    }
    const saved = this.list(userId).find((provider) => provider.id === id);
    if (!apiKey && !saved?.configured)
      throw new NotFoundError("Provider is not configured");
    const endpoint = providerEndpoint(
      id,
      baseUrl ?? (saved?.baseUrl || undefined),
    );
    if (!apiKey && endpoint !== (saved?.baseUrl || undefined))
      throw new ConflictError(
        "Enter the API key again when changing the provider endpoint",
      );
    return {
      models: await this.transport.models(
        apiKey
          ? { id, model: "", apiKey, baseUrl: endpoint }
          : await this.credentials(userId, id),
      ),
    };
  }
}

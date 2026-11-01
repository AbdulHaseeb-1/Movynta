import { Inject, Injectable } from "@nestjs/common";
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
import {
  PROVIDER_IDS,
  type ProviderId,
  type ProviderView,
  type ProviderCredentials,
} from "./providers.types.js";
import { providerEndpoint } from "./provider-endpoint.js";

@Injectable()
export class ProvidersService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(SECRET_PROTECTOR) private readonly vault: SecretProtector,
    private readonly transport: ProviderTransport,
  ) {}

  list(userId: string): ProviderView[] {
    return PROVIDER_IDS.map((id) => {
      const row = this.database.db
        .prepare(
          "SELECT model, active, base_url FROM model_providers WHERE user_id = ? AND provider_id = ?",
        )
        .get(userId, id);
      return {
        id,
        model: row ? textColumn(row, "model") : "",
        configured: Boolean(row),
        active: row ? integerColumn(row, "active") === 1 : false,
        baseUrl: row ? (optionalTextColumn(row, "base_url") ?? "") : "",
      };
    });
  }

  async save(
    userId: string,
    id: ProviderId,
    model: string,
    apiKey: string | undefined,
    baseUrl?: string,
  ): Promise<ProviderView[]> {
    const previous = this.database.db
      .prepare(
        "SELECT encrypted_key, base_url FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .get(userId, id);
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
        `INSERT INTO model_providers (user_id, provider_id, model, encrypted_key, active, base_url) VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT(user_id, provider_id) DO UPDATE SET model = excluded.model, encrypted_key = excluded.encrypted_key, base_url = excluded.base_url`,
      )
      .run(userId, id, model, encrypted, endpoint ?? null);
    if (!this.list(userId).some((provider) => provider.active))
      this.activate(userId, id);
    return this.list(userId);
  }

  activate(userId: string, id: ProviderId): ProviderView[] {
    if (
      !this.list(userId).some(
        (provider) => provider.id === id && provider.configured,
      )
    )
      throw new NotFoundError("Configure this provider first");
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

  remove(userId: string, id: ProviderId): ProviderView[] {
    this.database.db
      .prepare(
        "DELETE FROM model_providers WHERE user_id = ? AND provider_id = ?",
      )
      .run(userId, id);
    return this.list(userId);
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

  async models(
    userId: string,
    id: ProviderId,
    apiKey?: string,
    baseUrl?: string,
  ): Promise<{ models: string[] }> {
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

import { ValidationFailedError } from "../../common/errors/app-error.js";
import { isCompatibleProvider, type ProviderId } from "./providers.types.js";

/** Store a credential-free API prefix; appending resources preserves any proxy path. */
export function providerEndpoint(
  id: ProviderId,
  input: string | undefined,
): string | undefined {
  if (!isCompatibleProvider(id)) {
    if (input)
      throw new ValidationFailedError(
        "This provider uses its official endpoint",
      );
    return undefined;
  }
  try {
    if (!input) throw new Error("missing endpoint");
    const url = new URL(input);
    const local =
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local))
      throw new Error("insecure endpoint");
    if (url.username || url.password || url.search || url.hash)
      throw new Error("embedded credentials or query");
    return url.toString().replace(/\/+$/, "");
  } catch {
    throw new ValidationFailedError(
      "Enter an HTTPS base URL, or HTTP for localhost. Do not include credentials, a query, or a fragment.",
    );
  }
}

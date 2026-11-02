import { AppError } from "../../../common/errors/app-error.js";

/**
 * The ChatGPT sign-in is missing, expired, or was rejected. It uses 409 rather than 401, because the
 * desktop client treats 401 as "my backend token is stale" and would retry the request pointlessly.
 */
export class ChatgptSignInRequiredError extends AppError {
  readonly status = 409;
  readonly code = "chatgpt_sign_in_required";
}

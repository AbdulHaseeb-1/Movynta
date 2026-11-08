import type { AppDispatch } from "@/app/store";
import {
  chatgptSessionLoaded,
  chatgptSessionSchema,
  isSubscriptionProvider,
  providersLoaded,
  providersSchema,
  type ProviderId,
} from "@/features/providers";
import { backendRequest } from "@/lib/backend";

/**
 * Sends a change to one provider (such as removing its key) and stores the provider list the backend answers
 * with. Signing out of the subscription provider also ends its sign-in session, so that is read again and
 * the list stops showing the old account.
 */
export async function changeProvider(
  dispatch: AppDispatch,
  id: ProviderId,
  method: string,
  body?: unknown,
): Promise<void> {
  dispatch(providersLoaded(await backendRequest(`/providers/${id}`, providersSchema, method, body)));
  if (isSubscriptionProvider(id))
    dispatch(chatgptSessionLoaded(await backendRequest("/providers/chatgpt/session", chatgptSessionSchema)));
}

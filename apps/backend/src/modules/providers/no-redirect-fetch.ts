/** Provider requests never follow redirects, so a credential cannot be forwarded to another host. */
export const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" });

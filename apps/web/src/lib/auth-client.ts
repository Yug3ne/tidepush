import { createAuthClient } from "better-auth/react";
import { deviceAuthorizationClient } from "better-auth/client/plugins";

/** Browser-side Better Auth calls (sign in, sign up, sign out, device approval). Same origin. */
export const authClient = createAuthClient({ plugins: [deviceAuthorizationClient()] });

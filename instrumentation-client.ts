import * as Sentry from "@sentry/nextjs";
import { sentryOptions } from "@/lib/sentryOptions";

Sentry.init(sentryOptions);

// Lets Sentry link a client-side navigation to the server work it caused.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

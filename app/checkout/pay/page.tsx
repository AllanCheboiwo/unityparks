import { Suspense } from "react";
import { paymentsProvider } from "@/server/booking/provider";
import { PayClient } from "./PayClient";

// The provider is server-side knowledge (env vars); the page passes it down
// so the button and footnote can tell the truth about what happens next.
export default function PayPage() {
  return (
    <Suspense>
      <PayClient provider={paymentsProvider()} />
    </Suspense>
  );
}

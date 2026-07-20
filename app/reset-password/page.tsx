import type { Metadata } from "next";
import { Suspense } from "react";
import { ResetPasswordClient } from "./ResetPasswordClient";

export const metadata: Metadata = { title: "Reset password | Unity Parks" };

// useSearchParams needs a Suspense boundary when the page is prerendered.
export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordClient />
    </Suspense>
  );
}

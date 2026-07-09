import { Suspense } from "react";
import { GuestsClient } from "./GuestsClient";

export default function GuestsPage() {
  return (
    <Suspense>
      <GuestsClient />
    </Suspense>
  );
}

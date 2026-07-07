import { Suspense } from "react";
import { ExtrasClient } from "./ExtrasClient";

export default function ExtrasPage() {
  return (
    <Suspense>
      <ExtrasClient />
    </Suspense>
  );
}

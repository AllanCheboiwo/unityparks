import { Suspense } from "react";
import { LodgesClient } from "./LodgesClient";

export default function LodgesPage() {
  return (
    <Suspense>
      <LodgesClient />
    </Suspense>
  );
}

import { Suspense } from "react";
import { DetailsClient } from "./DetailsClient";

export default function DetailsPage() {
  return (
    <Suspense>
      <DetailsClient />
    </Suspense>
  );
}

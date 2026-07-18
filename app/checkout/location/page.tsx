import { Suspense } from "react";
import { LocationClient } from "./LocationClient";

export default function LocationPage() {
  return (
    <Suspense>
      <LocationClient />
    </Suspense>
  );
}

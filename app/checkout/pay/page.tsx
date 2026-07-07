import { Suspense } from "react";
import { PayClient } from "./PayClient";

export default function PayPage() {
  return (
    <Suspense>
      <PayClient />
    </Suspense>
  );
}

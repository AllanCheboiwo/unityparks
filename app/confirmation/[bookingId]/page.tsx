import { Suspense } from "react";
import { ConfirmationClient } from "./ConfirmationClient";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return (
    <Suspense>
      <ConfirmationClient bookingId={bookingId} />
    </Suspense>
  );
}

import { Suspense } from "react";
import { ManageClient } from "./ManageClient";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return (
    <Suspense>
      <ManageClient bookingId={bookingId} />
    </Suspense>
  );
}

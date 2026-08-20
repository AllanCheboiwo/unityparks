import { Suspense } from "react";
import { getExtrasContent } from "@/server/content";
import { ManageClient } from "./ManageClient";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  const extrasContent = await getExtrasContent();
  return (
    <Suspense>
      <ManageClient bookingId={bookingId} extrasContent={extrasContent} />
    </Suspense>
  );
}

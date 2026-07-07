import { ManageClient } from "./ManageClient";

export default async function ManagePage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <ManageClient bookingId={bookingId} />;
}

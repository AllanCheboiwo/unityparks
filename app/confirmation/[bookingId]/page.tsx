import { ConfirmationClient } from "./ConfirmationClient";

export default async function ConfirmationPage({
  params,
}: {
  params: Promise<{ bookingId: string }>;
}) {
  const { bookingId } = await params;
  return <ConfirmationClient bookingId={bookingId} />;
}

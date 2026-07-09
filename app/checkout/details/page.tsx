import { Suspense } from "react";
import { getCurrentUser } from "@/server/auth/session";
import { DetailsClient } from "./DetailsClient";

export default async function DetailsPage() {
  const user = await getCurrentUser();
  return (
    <Suspense>
      <DetailsClient
        initialUser={
          user
            ? {
                firstName: user.firstName,
                lastName: user.lastName,
                email: user.email,
                phone: user.phone ?? "",
              }
            : null
        }
      />
    </Suspense>
  );
}

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
                title: user.title ?? "",
                dateOfBirth: user.dateOfBirth ?? "",
                addressLine1: user.addressLine1 ?? "",
                addressLine2: user.addressLine2 ?? "",
                townCity: user.townCity ?? "",
                county: user.county ?? "",
                postcode: user.postcode ?? "",
                country: user.country ?? "",
                marketingEmail: user.marketingEmail,
                marketingSms: user.marketingSms,
              }
            : null
        }
      />
    </Suspense>
  );
}

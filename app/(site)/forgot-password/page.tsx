import type { Metadata } from "next";
import { ForgotPasswordClient } from "./ForgotPasswordClient";

export const metadata: Metadata = { title: "Forgotten password | Unity Parks" };

export default function ForgotPasswordPage() {
  return <ForgotPasswordClient />;
}

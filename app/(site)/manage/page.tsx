import { redirect } from "next/navigation";

/**
 * The find-my-booking challenge lived here until accounts became mandatory
 * (UNP-19). The URL survives because confirmation and reminder emails
 * already in inboxes link to it: /account asks the signed-out to sign in
 * and lists every booking the account owns once they have.
 */
export default function ManagePage() {
  redirect("/account");
}

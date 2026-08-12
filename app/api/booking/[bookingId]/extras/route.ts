import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/db";
import { assertBookingAccess } from "@/server/booking/access";
import {
  addManageExtras,
  quoteManageExtras,
  type RecordForExtras,
} from "@/server/booking/extras";
import { getCurrentUser } from "@/server/auth/session";
import { handleRoute, jsonError } from "@/server/api-helpers";
import { MAX_EXTRA_QTY } from "@/lib/extras";

/**
 * Extras after booking - the promise the checkout extras page makes. GET
 * quotes live offers per lodge (with what the reservation already holds);
 * POST adds a chosen set to one lodge. Money handling rides the booking's
 * payment state: paid bookings are charged on the folio immediately,
 * amend-style; deposit-paid bookings fold the charge into the outstanding
 * balance for the existing pay route to collect.
 */

const AddBody = z.object({
  slot: z.number().int().min(0).max(2),
  additions: z
    .array(
      z.object({
        serviceId: z.string().min(1).max(64),
        count: z.number().int().min(1).max(MAX_EXTRA_QTY),
      }),
    )
    .min(1)
    .max(10),
});

async function loadRecord(bookingId: string): Promise<RecordForExtras | null> {
  return prisma.bookingRecord.findFirst({
    where: { apaleoBookingId: bookingId },
    include: {
      session: { include: { lodges: { orderBy: { slot: "asc" } } } },
      reservations: { orderBy: { slot: "asc" } },
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await loadRecord(bookingId);
    if (!record) return jsonError(404, "Booking not found.");
    // Before anything Apaleo: failed probes must not burn the write budget.
    assertBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    return NextResponse.json(await quoteManageExtras(record));
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ bookingId: string }> },
) {
  return handleRoute(async () => {
    const { bookingId } = await params;
    const record = await loadRecord(bookingId);
    if (!record) return jsonError(404, "Booking not found.");
    assertBookingAccess(record, {
      user: await getCurrentUser(),
      sessionId: req.nextUrl.searchParams.get("session"),
      email: req.nextUrl.searchParams.get("email"),
    });

    const parsed = AddBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return jsonError(400, "Pick at least one extra to add.");

    const outcome = await addManageExtras(record, parsed.data.slot, parsed.data.additions);
    return NextResponse.json({ ok: true, ...outcome });
  });
}

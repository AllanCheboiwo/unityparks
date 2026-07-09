import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/server/booking/session";
import { guestRowDto, loadGuests, partyBands, saveGuests } from "@/server/booking/guests";
import { handleRoute, jsonError } from "@/server/api-helpers";

const GuestsBody = z.object({
  guests: z
    .array(
      z.object({
        position: z.number().int().min(0),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
        dateOfBirth: z.string().optional(),
        email: z.string().trim().email().optional(),
      }),
    )
    .max(20),
});

/** The Guests step's data: the booked party shape, any saved rows, and the
 * lead booker for prefilling row 0. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    return NextResponse.json({
      bands: partyBands(session),
      guests: (await loadGuests(id)).map(guestRowDto),
      lead: {
        firstName: session.guestFirstName,
        lastName: session.guestLastName,
        email: session.guestEmail,
      },
    });
  });
}

/** Save the manifest during the funnel. After the break is booked, edits go
 * through the booking route, which demands proof of access. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This break is booked. Edit your party from Manage my booking.");
    }

    const parsed = GuestsBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the guest details.");

    await saveGuests(session, parsed.data.guests);
    return NextResponse.json({ ok: true });
  });
}

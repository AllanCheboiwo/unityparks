import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, parseVehiclePlates } from "@/server/booking/session";
import { guestRowDto, loadGuests, partyBands, saveGuests } from "@/server/booking/guests";
import { handleRoute, jsonError } from "@/server/api-helpers";

const GuestsBody = z.object({
  guests: z
    .array(
      z.object({
        position: z.number().int().min(0),
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        dateOfBirth: z.string().optional(),
        email: z.string().trim().email().optional(),
      }),
    )
    .max(20),
  // Which lodge these guests stay in.
  slot: z.number().int().min(0).max(2).default(0),
});

/** The Guests step's data: each lodge's party shape and saved rows, plus the
 * lead booker for prefilling the first lodge's first adult. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");

    const rows = (await loadGuests(id)).map(guestRowDto);
    return NextResponse.json({
      lodges: session.lodges.map((lodge) => ({
        slot: lodge.slot,
        bands: partyBands(lodge),
        guests: rows.filter((r) => r.slot === lodge.slot),
      })),
      lead: {
        firstName: session.guestFirstName,
        lastName: session.guestLastName,
        email: session.guestEmail,
      },
      // Break-level car registrations, for prefilling the vehicle card.
      vehiclePlates: parseVehiclePlates(session),
    });
  });
}

/** Save one lodge's manifest during the funnel. After the break is booked,
 * edits go through the booking route, which demands proof of access. */
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
    const lodge = session.lodges.find((l) => l.slot === parsed.data.slot);
    if (!lodge) return jsonError(400, "That lodge slot is not part of this break.");

    // saveGuests rejects extra or duplicated rows; this side demands one row
    // per band seat, so the funnel can never save a lodge half-named.
    if (parsed.data.guests.length < partyBands(lodge).length) {
      return jsonError(400, "Please name everyone staying in this lodge.");
    }

    await saveGuests(lodge, parsed.data.guests);
    return NextResponse.json({ ok: true });
  });
}

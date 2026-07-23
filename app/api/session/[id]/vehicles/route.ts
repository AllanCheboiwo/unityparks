import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, setVehicles } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

// One entry per car, break-level (Center Parcs asks once for the whole party).
// Each string is the registration or "" for "I don't know the registration".
const VehiclesBody = z.object({
  plates: z.array(z.string().trim()).max(4),
});

/** Save the break's car registrations during the funnel. After the break is
 *  booked the session is frozen, matching the guests route. */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    const session = await getSession(id);
    if (!session) return jsonError(410, "Session expired.");
    if (session.state === "completed") {
      return jsonError(409, "This break is booked. Edit your details from Manage my booking.");
    }

    const parsed = VehiclesBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the vehicle details.");

    await setVehicles(id, parsed.data.plates);
    return NextResponse.json({ ok: true });
  });
}

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSession, setGuestDetails } from "@/server/booking/session";
import { handleRoute, jsonError } from "@/server/api-helpers";

const DetailsBody = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().min(7),
  vehiclePlate: z.string().optional(),
});

/** Lead guest details plus the vehicle plate for the ANPR gate. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return handleRoute(async () => {
    const { id } = await params;
    if (!(await getSession(id))) return jsonError(410, "Session expired.");

    const parsed = DetailsBody.safeParse(await req.json());
    if (!parsed.success) return jsonError(400, "Please check the details form.");

    await setGuestDetails(id, parsed.data);
    return NextResponse.json({ ok: true });
  });
}

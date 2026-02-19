import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await rateLimit(request);

  await prisma.user.delete({
    where: { id: params.id, orgId: session.user.orgId },
  });
  return NextResponse.json({ ok: true });
}

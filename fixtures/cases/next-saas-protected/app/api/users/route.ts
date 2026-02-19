import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await rateLimit(request);

  const users = await prisma.user.findMany({
    where: { orgId: session.user.orgId },
  });
  return NextResponse.json(users);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await rateLimit(request);

  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
      orgId: session.user.orgId,
    },
  });
  return NextResponse.json(user, { status: 201 });
}

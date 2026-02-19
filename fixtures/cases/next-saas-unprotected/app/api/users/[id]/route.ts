import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// DELETE - delete user by ID only (no auth, no tenant scoping)
export async function DELETE(
  request: Request,
  { params }: { params: { id: string } }
) {
  await prisma.user.delete({
    where: { id: params.id },
  });
  return NextResponse.json({ ok: true });
}

// PATCH - update user (no auth, no tenant scoping)
export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  const body = await request.json();
  const user = await prisma.user.update({
    where: { id: params.id },
    data: body,
  });
  return NextResponse.json(user);
}

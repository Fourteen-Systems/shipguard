import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// GET - list users (no auth, no rate limit)
export async function GET() {
  const users = await prisma.user.findMany();
  return NextResponse.json(users);
}

// POST - create user (no auth, no rate limit, no tenancy scoping)
export async function POST(request: Request) {
  const body = await request.json();
  const user = await prisma.user.create({
    data: {
      name: body.name,
      email: body.email,
    },
  });
  return NextResponse.json(user, { status: 201 });
}

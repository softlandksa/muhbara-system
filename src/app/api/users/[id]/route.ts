import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { z } from "zod";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";

const VALID_ROLES = [
  "ADMIN", "GENERAL_MANAGER", "SALES_MANAGER",
  "SALES", "SUPPORT", "SHIPPING", "FOLLOWUP", "HR",
] as const;

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(VALID_ROLES).optional(),
  teamId: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
});

export async function PUT(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "غير مصرح" }, { status: 401 });
  }
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  try {
    const { id } = await ctx.params;
    const body = await request.json();

    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "بيانات غير صحيحة" },
        { status: 400 }
      );
    }

    const { name, email, role, teamId, isActive, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
      return NextResponse.json({ error: "المستخدم غير موجود" }, { status: 404 });
    }

    // Cannot change own role or deactivate self
    if (id === session.user.id) {
      if (role !== undefined && role !== user.role) {
        return NextResponse.json(
          { error: "لا يمكنك تغيير دورك الخاص" },
          { status: 400 }
        );
      }
      if (isActive === false) {
        return NextResponse.json(
          { error: "لا يمكنك تعطيل حسابك الخاص" },
          { status: 400 }
        );
      }
    }

    if (email && email !== user.email) {
      const duplicate = await prisma.user.findUnique({ where: { email } });
      if (duplicate) {
        return NextResponse.json(
          { error: "البريد الإلكتروني مستخدم بالفعل" },
          { status: 409 }
        );
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email;
    if (role !== undefined) updateData.role = role;
    if (teamId !== undefined) updateData.teamId = teamId;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (password) updateData.passwordHash = await bcrypt.hash(password, 12);

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        teamId: true,
        isActive: true,
        avatar: true,
        createdAt: true,
        updatedAt: true,
        team: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({ data: updated }, { status: 200 });
  } catch (e) {
    console.error("PUT /api/users/[id] error:", e);
    return NextResponse.json({ error: "حدث خطأ أثناء تحديث بيانات الموظف" }, { status: 500 });
  }
}

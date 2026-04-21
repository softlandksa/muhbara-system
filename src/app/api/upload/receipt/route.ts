import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { uploadReceipt, ALLOWED_RECEIPT_MIMES, MAX_RECEIPT_SIZE } from "@/lib/storage";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "غير مصرح" }, { status: 401 });

  const { role } = session.user;
  if (role !== "ADMIN" && role !== "SALES" && role !== "SUPPORT") {
    return NextResponse.json({ error: "ممنوع" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "طلب غير صحيح" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "الملف مطلوب" }, { status: 400 });
  }

  if (file.size > MAX_RECEIPT_SIZE) {
    return NextResponse.json({ error: "حجم الملف يتجاوز الحد المسموح به (10 ميغابايت)" }, { status: 400 });
  }

  if (!ALLOWED_RECEIPT_MIMES.has(file.type)) {
    return NextResponse.json(
      { error: "نوع الملف غير مدعوم. الأنواع المقبولة: صور (JPG، PNG، WebP) أو PDF" },
      { status: 400 }
    );
  }

  try {
    const result = await uploadReceipt(await file.arrayBuffer(), file.type);
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "فشل رفع الملف";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

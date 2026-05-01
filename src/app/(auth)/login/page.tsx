"use client";

import { useState, useEffect } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Loader2, Eye, EyeOff, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

const loginSchema = z.object({
  email: z.email("بريد إلكتروني غير صالح"),
  password: z.string().min(1, "كلمة المرور مطلوبة"),
});

type LoginForm = z.infer<typeof loginSchema>;

function getErrorMessage(code: string | null | undefined): string {
  switch (code) {
    case "user_not_found":
      return "البريد الإلكتروني غير موجود";
    case "invalid_password":
      return "كلمة المرور غير صحيحة";
    case "hash_missing":
      return "كلمة المرور غير مهيأة لهذا المستخدم";
    case "database_error":
      return "تعذر الاتصال بقاعدة البيانات";
    case "account_disabled":
      return "الحساب معطّل. تواصل مع المدير";
    case "auth_error":
      return "حدث خطأ أثناء التحقق من كلمة المرور";
    case "CredentialsSignin":
      return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
    case "undefined":
    case undefined:
    case null:
      return "حدث خطأ في الخادم. تأكد من إعداد متغيرات البيئة (NEXTAUTH_SECRET)";
    default:
      return "حدث خطأ أثناء تسجيل الدخول";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);

  // Handle URL ?error= param — produced when NextAuth redirects (e.g. missing NEXTAUTH_SECRET)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const urlError = params.get("error");
    if (urlError) {
      toast.error(getErrorMessage(urlError));
      // Remove the error param from the address bar without a page reload
      const clean = new URL(window.location.href);
      clean.searchParams.delete("error");
      window.history.replaceState({}, "", clean.toString());
    }
  }, []);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
  });

  const onSubmit = async (data: LoginForm) => {
    const result = await signIn("credentials", {
      email: data.email,
      password: data.password,
      redirect: false,
    });

    console.log("LOGIN_RESULT", JSON.stringify(result));

    if (result?.error) {
      toast.error(getErrorMessage(result.error));
    } else {
      window.location.href = "/dashboard";
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1e2a4a] to-[#1d4ed8] p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white/10 rounded-2xl mb-4">
            <ShoppingBag size={32} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">نظام إدارة الطلبات</h1>
          <p className="text-blue-200 text-sm mt-1">لوحة تحكم التجارة الإلكترونية</p>
        </div>

        <Card className="shadow-2xl border-0">
          <CardHeader className="pb-4">
            <CardTitle className="text-xl">تسجيل الدخول</CardTitle>
            <CardDescription>
              أدخل بيانات حسابك للمتابعة
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  {...register("email")}
                />
                {errors.email && (
                  <p className="text-sm text-red-500">{errors.email.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">كلمة المرور</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    {...register("password")}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {errors.password && (
                  <p className="text-sm text-red-500">{errors.password.message}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full bg-[#1d4ed8] hover:bg-[#1e3a5f] text-white"
                disabled={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 size={16} className="animate-spin ml-2" />
                    جارٍ تسجيل الدخول...
                  </>
                ) : (
                  "تسجيل الدخول"
                )}
              </Button>
            </form>

            <p className="text-center text-sm text-gray-500 mt-4">
              لإنشاء حساب جديد، تواصل مع المدير
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

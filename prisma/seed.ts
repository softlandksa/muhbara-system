import "dotenv/config";
import { PrismaClient, Role } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 بدء تهيئة قاعدة البيانات...");

  // Admin user
  const passwordHash = await bcrypt.hash("Admin@123456", 12);
  const admin = await prisma.user.upsert({
    where: { email: "admin@system.com" },
    update: {},
    create: {
      name: "المدير العام",
      email: "admin@system.com",
      passwordHash,
      role: Role.ADMIN,
      isActive: true,
    },
  });
  console.log("✅ تم إنشاء حساب الأدمن:", admin.email);

  // Countries
  const countries = await Promise.all([
    prisma.country.upsert({
      where: { code: "EG" },
      update: { phoneFormat: "1XXXXXXXXX" },
      create: {
        name: "مصر",
        code: "EG",
        phoneCode: "+20",
        phoneFormat: "1XXXXXXXXX",
        isActive: true,
      },
    }),
    prisma.country.upsert({
      where: { code: "SA" },
      update: { phoneFormat: "5XXXXXXXX" },
      create: {
        name: "المملكة العربية السعودية",
        code: "SA",
        phoneCode: "+966",
        phoneFormat: "5XXXXXXXX",
        isActive: true,
      },
    }),
    prisma.country.upsert({
      where: { code: "AE" },
      update: { phoneFormat: "5XXXXXXXX" },
      create: {
        name: "الإمارات العربية المتحدة",
        code: "AE",
        phoneCode: "+971",
        phoneFormat: "5XXXXXXXX",
        isActive: true,
      },
    }),
  ]);
  console.log("✅ تم إنشاء الدول:", countries.map((c) => c.name).join(", "));

  // Currencies
  const currencies = await Promise.all([
    prisma.currency.upsert({
      where: { code: "EGP" },
      update: {},
      create: {
        name: "جنيه مصري",
        code: "EGP",
        symbol: "ج.م",
        isActive: true,
      },
    }),
    prisma.currency.upsert({
      where: { code: "SAR" },
      update: {},
      create: {
        name: "ريال سعودي",
        code: "SAR",
        symbol: "ر.س",
        isActive: true,
      },
    }),
    prisma.currency.upsert({
      where: { code: "AED" },
      update: {},
      create: {
        name: "درهم إماراتي",
        code: "AED",
        symbol: "د.إ",
        isActive: true,
      },
    }),
  ]);
  console.log("✅ تم إنشاء العملات:", currencies.map((c) => c.name).join(", "));

  // Payment Methods
  const paymentMethods = await Promise.all([
    prisma.paymentMethod.upsert({
      where: { name: "كاش عند الاستلام" },
      update: {},
      create: { name: "كاش عند الاستلام", isActive: true },
    }),
    prisma.paymentMethod.upsert({
      where: { name: "تحويل بنكي" },
      update: {},
      create: { name: "تحويل بنكي", isActive: true },
    }),
    prisma.paymentMethod.upsert({
      where: { name: "بطاقة ائتمان" },
      update: {},
      create: { name: "بطاقة ائتمان", isActive: true },
    }),
  ]);
  console.log(
    "✅ تم إنشاء طرق الدفع:",
    paymentMethods.map((p) => p.name).join(", ")
  );

  // Shipping Companies
  const shippingCompanies = await Promise.all([
    prisma.shippingCompany.upsert({
      where: { name: "أرامكس" },
      update: {},
      create: {
        name: "أرامكس",
        trackingUrl: "https://www.aramex.com/track/{tracking}",
        isActive: true,
      },
    }),
    prisma.shippingCompany.upsert({
      where: { name: "DHL" },
      update: {},
      create: {
        name: "DHL",
        trackingUrl: "https://www.dhl.com/track/{tracking}",
        isActive: true,
      },
    }),
    prisma.shippingCompany.upsert({
      where: { name: "FedEx" },
      update: {},
      create: {
        name: "FedEx",
        trackingUrl: "https://www.fedex.com/track/{tracking}",
        isActive: true,
      },
    }),
  ]);
  console.log(
    "✅ تم إنشاء شركات الشحن:",
    shippingCompanies.map((s) => s.name).join(", ")
  );

  // Shipping Statuses
  const shippingStatuses = await Promise.all([
    prisma.shippingStatusPrimary.upsert({
      where: { name: "جاهز للشحن" },
      update: { sortOrder: 0 },
      create: {
        name: "جاهز للشحن",
        color: "#3b82f6",
        sortOrder: 0,
        isActive: true,
      },
    }),
    prisma.shippingStatusPrimary.upsert({
      where: { name: "قيد التجهيز" },
      update: {},
      create: {
        name: "قيد التجهيز",
        color: "#f59e0b",
        sortOrder: 1,
        isActive: true,
      },
    }),
    prisma.shippingStatusPrimary.upsert({
      where: { name: "تم الاستلام من المرسل" },
      update: {},
      create: {
        name: "تم الاستلام من المرسل",
        color: "#3b82f6",
        sortOrder: 2,
        isActive: true,
      },
    }),
    prisma.shippingStatusPrimary.upsert({
      where: { name: "في الطريق" },
      update: {},
      create: {
        name: "في الطريق",
        color: "#8b5cf6",
        sortOrder: 3,
        isActive: true,
      },
    }),
    prisma.shippingStatusPrimary.upsert({
      where: { name: "خارج للتوصيل" },
      update: {},
      create: {
        name: "خارج للتوصيل",
        color: "#06b6d4",
        sortOrder: 4,
        isActive: true,
      },
    }),
    prisma.shippingStatusPrimary.upsert({
      where: { name: "تم التسليم" },
      update: {},
      create: {
        name: "تم التسليم",
        color: "#10b981",
        sortOrder: 5,
        isActive: true,
      },
    }),
  ]);
  console.log(
    "✅ تم إنشاء حالات الشحن:",
    shippingStatuses.map((s: { name: string }) => s.name).join(", ")
  );

  // Products
  const products = await Promise.all([
    prisma.product.upsert({
      where: { sku: "PROD-001" },
      update: {},
      create: {
        name: "منتج تجريبي 1",
        sku: "PROD-001",
        defaultPrice: 100,
        isActive: true,
      },
    }),
    prisma.product.upsert({
      where: { sku: "PROD-002" },
      update: {},
      create: {
        name: "منتج تجريبي 2",
        sku: "PROD-002",
        defaultPrice: 250,
        isActive: true,
      },
    }),
    prisma.product.upsert({
      where: { sku: "PROD-003" },
      update: {},
      create: {
        name: "منتج تجريبي 3",
        sku: "PROD-003",
        defaultPrice: 500,
        isActive: true,
      },
    }),
  ]);
  console.log(
    "✅ تم إنشاء المنتجات:",
    products.map((p) => p.name).join(", ")
  );

  console.log("🎉 تم تهيئة قاعدة البيانات بنجاح!");
}

main()
  .catch((e) => {
    console.error("❌ خطأ:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

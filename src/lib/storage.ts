import { randomUUID } from "crypto";
import path from "path";

export const MAX_RECEIPT_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_RECEIPT_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

/**
 * Thrown when the storage backend is not configured or unavailable.
 * Always log `technicalMessage` server-side; only surface `userMessage` to employees.
 */
export class StorageConfigError extends Error {
  readonly userMessage: string;
  readonly technicalMessage: string;

  constructor(technicalMessage: string) {
    const userMessage =
      "تعذر رفع إيصال السداد حالياً. يرجى التواصل مع الإدارة أو المحاولة لاحقاً.";
    super(userMessage);
    this.name = "StorageConfigError";
    this.userMessage = userMessage;
    this.technicalMessage = technicalMessage;
  }
}

/** Returns true when Vercel Blob is configured and ready. */
export function isStorageReady(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN);
}

// Magic byte signatures → MIME type
const MAGIC_PATTERNS: Array<{ bytes: number[]; mime: string }> = [
  { bytes: [0xff, 0xd8, 0xff], mime: "image/jpeg" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], mime: "image/png" },
  { bytes: [0x25, 0x50, 0x44, 0x46], mime: "application/pdf" },
];

function detectMime(buf: Uint8Array): string | null {
  for (const { bytes, mime } of MAGIC_PATTERNS) {
    if (bytes.every((b, i) => buf[i] === b)) return mime;
  }
  // WebP: "RIFF" at 0-3, "WEBP" at 8-11
  if (
    buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
    buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50
  ) {
    return "image/webp";
  }
  return null;
}

function extFromMime(mime: string): string {
  return { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "application/pdf": ".pdf" }[mime] ?? "";
}

function mimeFromExt(ext: string): string {
  return (
    { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf" }[ext.toLowerCase()] ??
    "application/octet-stream"
  );
}

export type UploadResult = { storedUrl: string; mime: string; size: number };

export async function uploadReceipt(fileBuffer: ArrayBuffer, claimedMime: string): Promise<UploadResult> {
  const buf = new Uint8Array(fileBuffer);

  if (buf.length > MAX_RECEIPT_SIZE) {
    throw new Error("حجم الملف يتجاوز الحد المسموح به (10 ميغابايت)");
  }
  if (!ALLOWED_RECEIPT_MIMES.has(claimedMime)) {
    throw new Error("نوع الملف غير مدعوم. الأنواع المقبولة: صور (JPG، PNG، WebP) أو PDF");
  }
  const detected = detectMime(buf);
  if (detected && detected !== claimedMime) {
    throw new Error("نوع الملف لا يتطابق مع محتواه الفعلي");
  }

  // Production requires Vercel Blob — Lambda filesystem is ephemeral and read-only.
  if (process.env.NODE_ENV === "production" && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new StorageConfigError(
      "BLOB_READ_WRITE_TOKEN is not set. " +
        "Go to Vercel Dashboard → Storage → Blob, create/connect a store, " +
        "copy BLOB_READ_WRITE_TOKEN into Environment Variables, then redeploy."
    );
  }

  const uniqueName = `receipts/${randomUUID()}${extFromMime(claimedMime)}`;

  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { put } = await import("@vercel/blob");
    const blob = await put(uniqueName, Buffer.from(buf), {
      access: "public",
      contentType: claimedMime,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return { storedUrl: blob.url, mime: claimedMime, size: buf.length };
  }

  // Local filesystem fallback — development only.
  const { writeFile, mkdir } = await import("fs/promises");
  const dir = path.join(process.cwd(), "uploads", "receipts");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, path.basename(uniqueName)), buf);
  return { storedUrl: `local://${uniqueName}`, mime: claimedMime, size: buf.length };
}

export async function fetchReceiptBuffer(storedUrl: string): Promise<{ buffer: ArrayBuffer; mime: string }> {
  if (storedUrl.startsWith("local://")) {
    const rel = storedUrl.replace("local://", "");
    const { readFile } = await import("fs/promises");
    const nodeBuf = await readFile(path.join(process.cwd(), "uploads", rel));
    const buffer = nodeBuf.buffer.slice(nodeBuf.byteOffset, nodeBuf.byteOffset + nodeBuf.byteLength) as ArrayBuffer;
    return { buffer, mime: mimeFromExt(path.extname(rel)) };
  }
  const res = await fetch(storedUrl);
  if (!res.ok) throw new Error("الملف غير متاح");
  const buffer = await res.arrayBuffer();
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  return { buffer, mime };
}

export async function deleteFile(storedUrl: string): Promise<void> {
  if (storedUrl.startsWith("local://")) {
    const rel = storedUrl.replace("local://", "");
    const { unlink } = await import("fs/promises");
    await unlink(path.join(process.cwd(), "uploads", rel));
    return;
  }
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    const { del } = await import("@vercel/blob");
    await del(storedUrl, { token: process.env.BLOB_READ_WRITE_TOKEN });
  }
}

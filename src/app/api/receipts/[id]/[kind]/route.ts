import { getCurrentUser } from "@/lib/auth/session";
import { UPLOAD_EXTENSIONS, UPLOAD_TYPES, type UploadType } from "@/lib/domain/files";
import { getReceiptFile } from "@/lib/server/receipts";
import { idSchema } from "@/lib/validation/settings";

/**
 * File of one of the signed-in user's receipts (ADR-027). Served with its stored type
 * (checked by magic bytes at upload), never sniffed, sandboxed, and never cached publicly.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/receipts/[id]/[kind]">) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const params = await ctx.params;
  const id = idSchema.safeParse(params.id);
  const kind = params.kind === "original" || params.kind === "thumbnail" ? params.kind : null;
  if (!id.success || !kind) return new Response(null, { status: 404 });
  const file = await getReceiptFile(user.id, id.data, kind);
  if (!file || !UPLOAD_TYPES.includes(file.mimeType as UploadType)) {
    return new Response(null, { status: 404 });
  }
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `inline; filename="ticket.${UPLOAD_EXTENSIONS[file.mimeType]}"`,
      // Files never change for a given receipt id.
      "cache-control": "private, max-age=86400, immutable",
      // Browsers' PDF viewers refuse to render under a sandbox CSP: PDFs get the strict
      // policy without it (no script source is allowed either way).
      "content-security-policy":
        file.mimeType === "application/pdf"
          ? "default-src 'none'; img-src 'self'; frame-ancestors 'none'"
          : "default-src 'none'; img-src 'self'; sandbox",
      "x-content-type-options": "nosniff",
      "cross-origin-resource-policy": "same-origin",
    },
  });
}

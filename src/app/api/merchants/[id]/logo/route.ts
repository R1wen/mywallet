import { getCurrentUser } from "@/lib/auth/session";
import { getMerchantLogoImage } from "@/lib/server/logos";
import { idSchema } from "@/lib/validation/settings";

/**
 * Logo of one of the signed-in user's merchants: uploaded image or cached favicon (ADR-022).
 * 404 means "show the monogram". Never a proxy: the id must be a merchant of this user.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/merchants/[id]/logo">) {
  const user = await getCurrentUser();
  if (!user) return new Response(null, { status: 401 });
  const id = idSchema.safeParse((await ctx.params).id);
  if (!id.success) return new Response(null, { status: 404 });
  const image = await getMerchantLogoImage(user.id, id.data);
  if (!image) {
    return new Response(null, {
      status: 404,
      headers: { "cache-control": "private, max-age=3600" },
    });
  }
  return new Response(new Uint8Array(image.data), {
    headers: {
      "content-type": image.contentType,
      // The URL carries ?v=<updatedAt>: a change of logo gets a new URL.
      "cache-control": "private, max-age=86400",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    },
  });
}

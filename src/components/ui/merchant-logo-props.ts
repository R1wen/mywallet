import type { MerchantLogoProps } from "./merchant-logo";

/** Props of <MerchantLogo> from a resolved merchant logo (server data). */
export function merchantLogoProps(m: {
  id: string;
  name: string;
  logo: { kind: "upload" | "brand" | "favicon" | "monogram" };
  brand: { path: string } | null;
  logoVersion: number;
}): MerchantLogoProps {
  const route = `/api/merchants/${m.id}/logo?v=${m.logoVersion}`;
  switch (m.logo.kind) {
    case "upload":
    case "favicon":
      return { name: m.name, src: route };
    case "brand":
      return { name: m.name, brandPath: m.brand?.path ?? null };
    default:
      return { name: m.name };
  }
}

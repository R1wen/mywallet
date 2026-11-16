"use client";

import { useEffect, useRef, useState } from "react";
import { merchantInitials } from "@/lib/domain/merchant";
import { cn } from "@/lib/utils";

export type MerchantLogoProps = {
  name: string;
  /** URL servie par notre propre route (cache serveur), jamais un fournisseur tiers en direct. */
  src?: string | null;
  /** Icône de marque simple-icons (tracé SVG), rendue en monochrome. */
  brandPath?: string | null;
  size?: 28 | 32 | 36 | 48;
  className?: string;
};

const sizes = {
  28: "size-7 text-xs",
  32: "size-8 text-xs",
  36: "size-9 text-sm",
  48: "size-12 text-md",
} as const;

/**
 * Pastille carrée à coins arrondis : logo importé ou favicon, icône de marque monochrome,
 * sinon monogramme sur --surface-2. Une image introuvable (404) retombe sur le monogramme.
 */
export function MerchantLogo({ name, src, brandPath, size = 32, className }: MerchantLogoProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // L'image peut échouer avant l'hydratation (rendu serveur) : onError n'est alors jamais
  // appelé. On vérifie son état au montage.
  useEffect(() => {
    const img = imgRef.current;
    if (src && img?.complete && img.naturalWidth === 0) setFailedSrc(src);
  }, [src]);
  const box = cn(
    "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-sm border border-border bg-surface-2",
    sizes[size],
    className,
  );
  if (src && failedSrc !== src) {
    return (
      <span className={box}>
        {/* eslint-disable-next-line @next/next/no-img-element -- logo servi depuis notre cache, déjà dimensionné */}
        <img
          ref={imgRef}
          src={src}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          onError={() => setFailedSrc(src)}
          className="size-full object-contain p-1"
        />
        <span className="sr-only">{name}</span>
      </span>
    );
  }
  if (brandPath) {
    return (
      <span className={cn(box, "text-text")} role="img" aria-label={name}>
        <svg viewBox="0 0 24 24" aria-hidden className="size-[55%] fill-current">
          <path d={brandPath} />
        </svg>
      </span>
    );
  }
  return (
    <span className={cn(box, "font-medium text-muted")} aria-label={name} role="img">
      {merchantInitials(name)}
    </span>
  );
}

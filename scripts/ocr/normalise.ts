/**
 * Normalisation commune au banc OCR Node et à la vérification navigateur : orientation EXIF,
 * niveaux de gris, grand côté <= 2000 px (ADR-027), puis redressement optionnel.
 * Le redressement est un profil de projection simple, transposable tel quel en canvas.
 */
import sharp from "sharp";

export type Normalised = { png: Buffer; angle: number };

export async function normalise(file: string | Buffer, deskew: boolean): Promise<Normalised> {
  const base = await sharp(file)
    .rotate()
    .grayscale()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();
  if (!deskew) return { png: base, angle: 0 };
  const angle = await estimateSkew(base);
  if (angle === 0) return { png: base, angle };
  const png = await sharp(base).rotate(angle, { background: "#ffffff" }).png().toBuffer();
  return { png, angle };
}

/** Netteté du profil horizontal : somme des carrés des écarts d'encre entre lignes voisines. */
function profileScore(data: Buffer, width: number, height: number): number {
  let prev = 0;
  let score = 0;
  for (let y = 0; y < height; y++) {
    let ink = 0;
    for (let x = 0; x < width; x++) if (data[y * width + x]! < 128) ink++;
    if (y > 0) score += (ink - prev) ** 2;
    prev = ink;
  }
  return score;
}

/**
 * Angle de redressement en degrés (-6..6, pas de 0,25) mesuré sur le centre de l'image pour
 * ignorer le fond autour du ticket. Renvoie 0 si aucun angle n'améliore nettement le profil.
 */
export async function estimateSkew(png: Buffer): Promise<number> {
  const meta = await sharp(png).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const sample = await sharp(png)
    .extract({
      left: Math.round(w * 0.2),
      top: Math.round(h * 0.2),
      width: Math.round(w * 0.6),
      height: Math.round(h * 0.6),
    })
    .resize({ width: 500, withoutEnlargement: true })
    .normalise()
    .png()
    .toBuffer();
  const scoreAt = async (a: number) => {
    const { data, info } = await sharp(sample)
      .rotate(a, { background: "#ffffff" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return profileScore(data, info.width, info.height);
  };
  const zero = await scoreAt(0);
  let best = 0;
  let bestScore = zero;
  for (let a = -6; a <= 6; a += 0.25) {
    if (a === 0) continue;
    const s = await scoreAt(a);
    if (s > bestScore) [best, bestScore] = [a, s];
  }
  return bestScore > zero * 1.1 ? best : 0;
}

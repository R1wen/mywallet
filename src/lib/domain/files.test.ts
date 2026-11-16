import { describe, expect, it } from "vitest";
import { checkUpload, detectUploadType, MAX_UPLOAD_BYTES, sanitizeFilename } from "./files";

const bytes = (...parts: (number[] | string)[]) =>
  new Uint8Array(
    parts.flatMap((p) => (typeof p === "string" ? [...p].map((c) => c.charCodeAt(0)) : p)),
  );

describe("detectUploadType", () => {
  it.each([
    ["jpeg", bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg"],
    ["png", bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png"],
    ["webp", bytes("RIFF", [0, 0, 0, 0], "WEBP"), "image/webp"],
    ["pdf", bytes("%PDF-1.7"), "application/pdf"],
    ["heic", bytes([0, 0, 0, 0x18], "ftypheic"), "image/heic"],
    ["heic mif1", bytes([0, 0, 0, 0x18], "ftypmif1"), "image/heic"],
    ["avif is refused", bytes([0, 0, 0, 0x18], "ftypavif"), null],
    ["svg is refused", bytes("<svg xmlns"), null],
    ["html renamed .jpg", bytes("<!doctype html>"), null],
    ["empty", bytes(), null],
    ["gif is refused", bytes("GIF89a"), null],
  ])("%s", (_, input, expected) => {
    expect(detectUploadType(input)).toBe(expected);
  });
});

describe("checkUpload", () => {
  it("accepts a small jpeg", () => {
    expect(checkUpload({ type: "image/jpeg", size: 200_000 })).toBeNull();
  });

  it.each([
    [{ type: null, size: 10 }, "Format non pris en charge (JPG, PNG, WebP, HEIC ou PDF)."],
    [{ type: "image/jpeg" as const, size: 0 }, "Fichier vide."],
    [
      { type: "application/pdf" as const, size: MAX_UPLOAD_BYTES["application/pdf"] + 1 },
      "Fichier trop volumineux (8 Mo maximum).",
    ],
    [
      { type: "image/heic" as const, size: MAX_UPLOAD_BYTES["image/heic"] + 1 },
      "Fichier trop volumineux (12 Mo maximum).",
    ],
  ])("%j -> %s", (input, message) => {
    expect(checkUpload(input)).toBe(message);
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["ticket.jpg", "ticket.jpg"],
    ["C:\\Users\\moi\\Desktop\\Ticket Carrefour.JPG", "Ticket Carrefour.JPG"],
    ["../../etc/passwd", "passwd"],
    ["fac\u0000ture\u202e.pdf", "facture.pdf"],
    ["  <script>.png  ", "script.png"],
    ["", "fichier"],
    ["...", "fichier"],
    [`${"a".repeat(300)}.pdf`, `${"a".repeat(116)}.pdf`],
    ["Reçu pâtisserie.jpeg", "Reçu pâtisserie.jpeg"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizeFilename(input)).toBe(expected);
  });
});

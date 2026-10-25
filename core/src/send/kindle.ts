// Send to Kindle by email. Magpie writes an unsent message (.eml with
// X-Unsent: 1) and opens it, so Apple Mail shows a ready draft with the books
// attached and the Kindle address filled in. The person presses Send; nothing
// leaves the Mac without them.

export const KINDLE_LIMIT = 50 * 1024 * 1024;

export interface Attachment {
  name: string;
  bytes: Uint8Array;
}

export function kindleDraft(to: string, books: Attachment[], subject: string): Uint8Array {
  const boundary = `magpie-${Math.random().toString(36).slice(2)}`;
  const lines = [
    "X-Unsent: 1",
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Sent from Magpie.",
  ];
  for (const b of books) {
    lines.push(
      `--${boundary}`,
      `Content-Type: application/epub+zip; name="${b.name}"`,
      `Content-Disposition: attachment; filename="${b.name}"`,
      "Content-Transfer-Encoding: base64",
      "",
      base64(b.bytes).replace(/.{76}/g, "$&\r\n"),
    );
  }
  lines.push(`--${boundary}--`, "");
  return new TextEncoder().encode(lines.join("\r\n"));
}

function encodeHeader(s: string): string {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(new TextEncoder().encode(s))}?=`;
}

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

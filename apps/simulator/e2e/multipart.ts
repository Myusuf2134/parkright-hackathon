/** Minimal multipart/form-data parser for inspecting what actually went over the wire. */
export interface Part {
  name: string;
  filename: string | null;
  contentType: string | null;
  headers: string;
  body: Buffer;
}

export function parseMultipart(body: Buffer, contentType: string): Part[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)?.slice(1).find(Boolean);
  if (!boundary) throw new Error(`no boundary in ${contentType}`);
  const delimiter = Buffer.from(`--${boundary}`);
  const parts: Part[] = [];
  let pos = body.indexOf(delimiter);
  while (pos !== -1) {
    const start = pos + delimiter.length;
    if (body.subarray(start, start + 2).toString() === '--') break;
    const next = body.indexOf(delimiter, start);
    const chunk = body.subarray(start + 2, next - 2); // strip CRLF after delimiter and before the next
    const split = chunk.indexOf('\r\n\r\n');
    const headers = chunk.subarray(0, split).toString('utf8');
    parts.push({
      name: /name="([^"]*)"/.exec(headers)?.[1] ?? '',
      filename: /filename="([^"]*)"/.exec(headers)?.[1] ?? null,
      contentType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim() ?? null,
      headers,
      body: chunk.subarray(split + 4),
    });
    pos = next;
  }
  return parts;
}

/** JPEG marker segments before the image data (SOS). */
export function jpegMarkers(jpeg: Buffer): number[] {
  const markers: number[] = [];
  let i = 2;
  while (i + 4 <= jpeg.length && jpeg[i] === 0xff) {
    const marker = jpeg[i + 1]!;
    markers.push(marker);
    if (marker === 0xda) break;
    i += 2 + jpeg.readUInt16BE(i + 2);
  }
  return markers;
}

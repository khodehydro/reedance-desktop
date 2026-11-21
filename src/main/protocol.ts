import fs from "node:fs";
import { Readable } from "node:stream";
import { protocol } from "electron";
import { readMedia } from "./projects";

/**
 * Local media protocol for audio preview and cover art.
 *
 * The renderer never receives a filesystem path it can read directly: the URL
 * only identifies a project, and the main process resolves that to the media
 * copy recorded in its own database. Range requests are supported so seeking in
 * the audio element works without loading the whole file.
 */
export const MEDIA_SCHEME = "rdmedia";

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
}

function mimeFor(kind: "audio" | "cover" | "story-audio", stored: string | undefined): string {
  if (stored) return stored;
  return kind === "audio" ? "audio/mpeg" : kind === "cover" ? "image/jpeg" : "audio/mpeg";
}

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const segments = url.pathname.split("/").filter(Boolean);
      const kind = segments[0];
      const projectId = segments[1];
      if (!projectId || (kind !== "audio" && kind !== "cover" && kind !== "story-audio")) {
        return new Response("not found", { status: 404 });
      }
      const media = readMedia(projectId);
      if (!media) return new Response("no media for this project", { status: 404 });
      const file =
        kind === "audio" ? media.media.audioPath
          : kind === "cover" ? media.media.coverPath
            : media.media.storyAudioPath;
      if (!file || !fs.existsSync(file)) return new Response("media file missing", { status: 404 });
      const stat = fs.statSync(file);
      const stored =
        kind === "audio" ? media.media.mimeType
          : kind === "cover" ? media.media.coverMimeType
            : media.media.storyAudioMimeType;
      const type = mimeFor(kind, stored);
      const range = request.headers.get("range");
      if (range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
        if (!match) return new Response("invalid range", { status: 416 });
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
        if (Number.isNaN(start) || start > end || start >= stat.size) {
          return new Response("range not satisfiable", {
            status: 416,
            headers: { "content-range": `bytes */${stat.size}` },
          });
        }
        const stream = fs.createReadStream(file, { start, end });
        return new Response(Readable.toWeb(stream) as ReadableStream, {
          status: 206,
          headers: {
            "content-type": type,
            "content-length": String(end - start + 1),
            "content-range": `bytes ${start}-${end}/${stat.size}`,
            "accept-ranges": "bytes",
            "cache-control": "no-store",
          },
        });
      }
      const stream = fs.createReadStream(file);
      return new Response(Readable.toWeb(stream) as ReadableStream, {
        status: 200,
        headers: {
          "content-type": type,
          "content-length": String(stat.size),
          "accept-ranges": "bytes",
          "cache-control": "no-store",
        },
      });
    } catch (error) {
      console.error("media protocol error", error);
      return new Response("internal error", { status: 500 });
    }
  });
}

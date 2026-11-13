export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return "—";
  const clamped = Math.max(0, Math.round(ms));
  const minutes = Math.floor(clamped / 60000);
  const seconds = Math.floor((clamped % 60000) / 1000);
  const millis = clamped % 1000;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function parseTimecode(value: string): number | null {
  const text = value.trim();
  if (!text) return null;
  const clock = /^(\d{1,3}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(text);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    const millis = clock[3] ? Number(clock[3].padEnd(3, "0")) : 0;
    if (seconds > 59) return null;
    return minutes * 60000 + seconds * 1000 + millis;
  }
  if (/^\d+$/.test(text)) return Number(text);
  return null;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatSeconds(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.toLocaleDateString("en-GB")} ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

export function shortHash(hash: string | null | undefined, length = 10): string {
  if (!hash) return "—";
  return hash.length > length * 2 ? `${hash.slice(0, length)}…${hash.slice(-4)}` : hash;
}

export function versionLabel(code: number): string {
  return `v${String(code).padStart(6, "0")}`;
}

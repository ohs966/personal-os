// Server shim for things only the OS itself (in a browser) can do: opening pages, downloading backups,
// voice settings. On the server they become a polite "do this inside the OS" reply.
export const INSIDE_OS = "That one needs the OS itself: open it on your phone or laptop.";
export function browserOnly(kinds: string[]): string {
  if (!kinds.length) return "";
  if (kinds.includes("backup") || kinds.includes("download")) return "Backups download from the OS itself: open it, then Options, Download backup.";
  return INSIDE_OS;
}

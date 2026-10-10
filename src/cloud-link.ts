import type { Store } from "./types";

export type CloudLink = { revision: number; fingerprint: string };
const KEY = "seo-studio-cloud-link-v1";

export async function fingerprintStore(store: Store): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(store)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readCloudLink(): CloudLink | null {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) || "null");
    if (value && Number.isSafeInteger(value.revision) && value.revision >= 0 && /^[a-f0-9]{64}$/.test(value.fingerprint)) return value;
  } catch { /* Missing browser storage keeps transfer explicit. */ }
  return null;
}

export async function rememberCloudLink(store: Store, revision: number): Promise<void> {
  const link = { revision, fingerprint: await fingerprintStore(store) };
  try { localStorage.setItem(KEY, JSON.stringify(link)); } catch { /* Data remains in IndexedDB; next reconnect requires review. */ }
}

export function forgetCloudLink(): void {
  try { localStorage.removeItem(KEY); } catch { /* No private data is stored in this marker. */ }
}

/** Resume known snapshots without guessing whether an unlinked local copy is newer. */
export function cloudResumeDecision(localFingerprint: string | null, remoteRevision: number, hasRemote: boolean, link: CloudLink | null): "cloud" | "local" | "review" | "conflict" {
  // A brand-new browser has no data to overwrite. Start syncing the initial
  // workspace; existing local data still requires an explicit safe transfer.
  if (!hasRemote) return localFingerprint === null && remoteRevision === 0 && !link ? "local" : "review";
  if (localFingerprint === null) return "cloud";
  if (!link) return "review";
  if (localFingerprint === link.fingerprint) return "cloud";
  return remoteRevision === link.revision ? "local" : "conflict";
}

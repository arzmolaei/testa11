import { describe, it, expect } from "vitest";
import { cloudResumeDecision, fingerprintStore } from "../src/cloud-link";
import { demoStore } from "../src/domain";

describe("safe cloud resuming", () => {
  const fingerprint = "a".repeat(64);
  const link = { revision: 3, fingerprint };
  it("loads shared data on a fresh device", () => expect(cloudResumeDecision(null, 6, true, null)).toBe("cloud"));
  it("starts syncing a fresh installation with an empty cloud", () => expect(cloudResumeDecision(null, 0, false, null)).toBe("local"));
  it("preserves unlinked local work when the cloud is empty", () => expect(cloudResumeDecision(fingerprint, 0, false, null)).toBe("review"));
  it("does not initialize a cleared cloud from a fresh device", () => expect(cloudResumeDecision(null, 6, false, null)).toBe("review"));
  it("asks before replacing an existing unlinked local workspace", () => expect(cloudResumeDecision("b".repeat(64), 6, true, null)).toBe("review"));
  it("loads the latest cloud version when local data matches the last sync", () => expect(cloudResumeDecision(fingerprint, 6, true, link)).toBe("cloud"));
  it("retains offline edits and resumes against the matching cloud revision", () => expect(cloudResumeDecision("b".repeat(64), 3, true, link)).toBe("local"));
  it("preserves local changes when another device has changed the cloud", () => expect(cloudResumeDecision("b".repeat(64), 4, true, link)).toBe("conflict"));
  it("does not automatically replace an empty or cleared cloud workspace", () => expect(cloudResumeDecision(fingerprint, 0, false, link)).toBe("review"));
  it("fingerprints the complete immutable-ID workspace including manual notes", async () => {
    const first = demoStore();
    const fingerprint = await fingerprintStore(first);
    expect(fingerprint).toHaveLength(64);
    expect(await fingerprintStore(structuredClone(first))).toBe(fingerprint);
    first.projects[0].keywords[0].notes = "ویرایش آفلاین";
    expect(await fingerprintStore(first)).not.toBe(fingerprint);
  });
});

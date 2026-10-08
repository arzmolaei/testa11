import { describe, expect, it } from "vitest";
import { createProject, DEFAULT_SETTINGS } from "../src/domain";
import { analyzePageCandidates, buildPagePlan } from "../src/page-intelligence";
import { boundedHistory, HISTORY_LIMIT, makeHistoryEntry, replayHistory, validateHistory } from "../src/workspace-history";
import type { Store } from "../src/types";

function fixture(): Store {
  const project = { ...createProject("پروژه"), id: "p1", keywords: [
    { id: "a", keyword: "خرید دوربین", intent: "", group: "" },
    { id: "b", keyword: "قیمت دوربین", intent: "", group: "" },
    { id: "c", keyword: "آموزش نصب دوربین", intent: "", group: "" },
  ] };
  return { version: 1, projects: [project], activeProjectId: project.id, settings: { ...DEFAULT_SETTINGS } };
}
function changed(base: Store, edit: (next: Store) => void): Store { const next = structuredClone(base); edit(next); return next; }

describe("guarded workspace undo", () => {
  it("undoes a bulk edit, retains unrelated teammate fields and redoes without mutating snapshots", async () => {
    const before = fixture();
    const after = changed(before, next => { next.projects[0].keywords[0].intent = "تراکنشی"; next.projects[0].keywords[1].intent = "تراکنشی"; });
    const entry = (await makeHistoryEntry(before, after))!;
    const remote = changed(after, next => { next.projects[0].keywords[0].group = "تیم"; });
    const undone = await replayHistory(remote, entry, "undo");
    expect(undone.state.projects[0].keywords[0]).toMatchObject({ intent: "", group: "تیم" });
    expect(undone.state.projects[0].keywords[1].intent).toBe("");
    const redone = await replayHistory(undone.state, undone.entry, "redo");
    expect(redone.state.projects[0].keywords[0]).toMatchObject({ intent: "تراکنشی", group: "تیم" });
    expect(remote.projects[0].keywords[0]).not.toHaveProperty("updatedAt");
    expect(before.projects[0].keywords[0].intent).toBe("");
  });

  it("rejects the entire undo when a real field changed later", async () => {
    const before = fixture(), after = changed(before, next => { next.projects[0].keywords[0].intent = "تراکنشی"; next.projects[0].keywords[1].group = "فروش"; });
    const entry = (await makeHistoryEntry(before, after))!;
    const remote = changed(after, next => { next.projects[0].keywords[0].intent = "اطلاعاتی"; });
    await expect(replayHistory(remote, entry, "undo")).rejects.toThrow("هیچ داده‌ای");
    expect(remote.projects[0].keywords[1].group).toBe("فروش");
  });

  it("restores deleted rows in their original position around newer teammate rows", async () => {
    const before = fixture(), after = changed(before, next => { next.projects[0].keywords.splice(1, 1); });
    const entry = (await makeHistoryEntry(before, after))!;
    const remote = changed(after, next => { next.projects[0].keywords.splice(1, 0, { id: "team", keyword: "کلمهٔ تیم", intent: "", group: "" }); });
    const undone = await replayHistory(remote, entry, "undo");
    expect(undone.state.projects[0].keywords.map(row => row.id)).toEqual(["a", "team", "b", "c"]);
    const redone = await replayHistory(undone.state, undone.entry, "redo");
    expect(redone.state.projects[0].keywords.map(row => row.id)).toEqual(["a", "team", "c"]);
    const restored = changed(undone.state, next => { next.projects[0].keywords.find(row => row.id === "b")!.notes = "کار جدید"; });
    await expect(replayHistory(restored, undone.entry, "redo")).rejects.toThrow("متوقف");
  });

  it("supports create, edit, multiple undo and redo despite changed bookkeeping timestamps", async () => {
    const before = fixture(), created = changed(before, next => { next.projects[0].pages.push({ id: "new", pkw: "دوربین", createdAt: "2026-10-01T08:00:00.000Z", updatedAt: "2026-10-01T08:00:00.000Z" }); });
    const createEntry = (await makeHistoryEntry(before, created))!;
    const edited = changed(created, next => { next.projects[0].pages[0].notes = "بریف"; next.projects[0].pages[0].updatedAt = "2026-10-02T08:00:00.000Z"; });
    const editEntry = (await makeHistoryEntry(created, edited))!;
    const undoEdit = await replayHistory(edited, editEntry, "undo");
    const undoCreate = await replayHistory(undoEdit.state, createEntry, "undo");
    expect(undoCreate.state.projects[0].pages).toHaveLength(0);
    const redoCreate = await replayHistory(undoCreate.state, undoCreate.entry, "redo");
    const redoEdit = await replayHistory(redoCreate.state, undoEdit.entry, "redo");
    expect(redoEdit.state.projects[0].pages[0]).toMatchObject({ id: "new", notes: "بریف" });
  });

  it("undoes a whole reviewed page plan, briefs and keyword relationships together", async () => {
    const before = fixture(), candidates = analyzePageCandidates(before.projects[0]);
    const plan = buildPagePlan(before.projects[0], candidates, candidates.map(row => ({ candidateId: row.id, priority: "P1" })), { createBriefs: true });
    const after = { ...before, projects: [plan.project] };
    expect(plan.project.pages.every(row => row.priority === "P1")).toBe(true);
    expect(plan.project.content.every(row => row.priority === "P1")).toBe(true);
    const entry = (await makeHistoryEntry(before, after))!;
    const undone = await replayHistory(after, entry, "undo");
    expect(undone.state.projects[0].pages).toEqual([]);
    expect(undone.state.projects[0].content).toEqual([]);
    expect(undone.state.projects[0].keywords.every(row => !row.targetPage)).toBe(true);
    const redone = await replayHistory(undone.state, undone.entry, "redo");
    expect(redone.state.projects[0].content).toHaveLength(plan.createdContent);
    expect(redone.state.projects[0].keywords.every(row => redone.state.projects[0].pages.some(page => page.id === row.targetPage))).toBe(true);
  });

  it("restores project deletion and active project without removing other projects", async () => {
    const before = fixture(); before.projects.push({ ...createProject("دوم"), id: "p2" });
    const after = changed(before, next => { next.projects.shift(); next.activeProjectId = "p2"; });
    const entry = (await makeHistoryEntry(before, after))!;
    const undone = await replayHistory(after, entry, "undo");
    expect(undone.state.projects.map(project => project.id)).toEqual(["p1", "p2"]);
    expect(undone.state.activeProjectId).toBe("p1");
    const redone = await replayHistory(undone.state, undone.entry, "redo");
    expect(redone.state.projects.map(project => project.id)).toEqual(["p2"]);
    expect(redone.state.activeProjectId).toBe("p2");
  });

  it("covers settings, task and link changes and skips navigation or timestamp-only changes", async () => {
    const before = fixture(), after = changed(before, next => { next.settings.titleMin = 35; next.projects[0].tasks = [{ id: "task", title: "بریف" }]; next.projects[0].links = [{ id: "link", anchor: "دوربین" }]; });
    const entry = (await makeHistoryEntry(before, after))!;
    const undone = await replayHistory(after, entry, "undo");
    expect(undone.state.settings.titleMin).toBe(before.settings.titleMin);
    expect(undone.state.projects[0].tasks || []).toEqual([]);
    expect(undone.state.projects[0].links || []).toEqual([]);
    expect(await makeHistoryEntry(before, changed(before, next => { next.projects[0].keywords[0].updatedAt = new Date().toISOString(); }))).toBeNull();
    before.projects.push({ ...createProject("دیگر"), id: "p2" });
    expect(await makeHistoryEntry(before, { ...before, activeProjectId: "p2" })).toBeNull();
  });

  it("bounds combined undo/redo history and rejects damaged saved entries", async () => {
    const before = fixture(), after = changed(before, next => { next.projects[0].name = "نام تازه"; });
    const entry = (await makeHistoryEntry(before, after))!;
    const value = boundedHistory({ version: 1, past: Array.from({ length: HISTORY_LIMIT + 3 }, (_, i) => ({ ...entry, id: String(i) })), future: [{ ...entry, id: "future" }] });
    expect(value.past.length + value.future.length).toBe(HISTORY_LIMIT);
    expect(validateHistory(value)).toBe(value);
    expect(() => validateHistory({ ...value, past: [{ ...entry, at: 2026 }] })).toThrow();
    expect(() => validateHistory({ ...value, past: [{ ...entry, undo: { version: 1, changes: [{ kind: "delete", collection: "keywords", projectId: "p1", rowId: "a", beforeHash: "bad" }] } }] })).toThrow();
  });
});

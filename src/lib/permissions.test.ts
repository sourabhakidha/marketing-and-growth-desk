import { describe, expect, it } from "vitest";
import { availableActions, awaitingApproval, heldByAdmin, type ActionContext } from "./permissions.ts";

const base: ActionContext = {
  meId: "me", isAdmin: false, status: "in_progress", ownerId: "me", createdBy: "me",
  activeStage: { ownerId: "me", pickedUp: true }, hasNextStage: true, hasEarlierDoneStage: true,
};

describe("availableActions", () => {
  it("lets the owner work but not approve or change restricted fields", () => {
    const a = availableActions(base);
    expect([...a]).toEqual(expect.arrayContaining(["hand_off", "submit", "block", "return_for_rework", "edit", "cancel"]));
    expect(a.has("approve")).toBe(false);
    expect(a.has("edit_restricted")).toBe(false);
  });
  it("only admins approve or request changes", () => {
    expect(availableActions({ ...base, status: "in_review" }).has("approve")).toBe(false);
    const admin = availableActions({ ...base, status: "in_review", isAdmin: true, meId: "boss" });
    expect(admin.has("approve") && admin.has("request_changes")).toBe(true);
  });
  it("gives an unrelated member nothing but view", () => {
    const a = availableActions({ ...base, meId: "other" });
    expect(a.size).toBe(0);
  });
  it("lets the stage owner pick up and hand off", () => {
    const a = availableActions({ ...base, meId: "editor", ownerId: "me", activeStage: { ownerId: "editor", pickedUp: false } });
    expect(a.has("pick_up") && a.has("hand_off")).toBe(true);
    expect(a.has("edit")).toBe(false);
  });
  it("closes everything except admin reopen once done", () => {
    expect(availableActions({ ...base, status: "done" }).size).toBe(0);
    expect([...availableActions({ ...base, status: "done", isAdmin: true })].sort()).toEqual(["edit", "edit_restricted", "reopen"]);
  });
  it("offers submit instead of hand-off on the last stage", () => {
    const a = availableActions({ ...base, hasNextStage: false });
    expect(a.has("hand_off")).toBe(false);
    expect(a.has("submit")).toBe(true);
  });
  it("holds the task for admins once a stage is handed to one (D-028)", () => {
    const held: ActionContext = { ...base, activeStage: { ownerId: "tanvi", pickedUp: false, ownerIsAdmin: true } };
    expect(heldByAdmin(held)).toBe(true);
    const a = availableActions(held);
    for (const x of ["hand_off", "submit", "block", "return_for_rework", "pick_up"] as const) expect(a.has(x)).toBe(false);
    expect(a.has("edit") && a.has("cancel")).toBe(true);
    const admin = availableActions({ ...held, meId: "sourabh", isAdmin: true });
    expect(admin.has("hand_off") && admin.has("return_for_rework")).toBe(true);
    expect(heldByAdmin({ ...held, isAdmin: true })).toBe(false);
  });
});

describe("awaitingApproval", () => {
  const admins = new Set(["tanvi", "sourabh"]);
  const isAdminMember = (id: string | null) => Boolean(id && admins.has(id));
  const nikita = { id: "nikita", isAdmin: false, isAdminMember };
  const tanvi = { id: "tanvi", isAdmin: true, isAdminMember };
  const t = (stage: string, stageOwner: string, over: object = {}) => ({
    status: "in_progress", owner_id: "nikita", created_by: "nikita",
    task_stages: [{ stage_code: "writing_scripting", state: "done", owner_id: "nikita" }, { stage_code: stage, state: "active", owner_id: stageOwner }],
    ...over,
  });
  it("lists work in internal review with an admin for the contributor and for every admin", () => {
    expect(awaitingApproval(t("internal_review", "tanvi"), nikita)).toBe(true);
    expect(awaitingApproval(t("internal_review", "tanvi"), tanvi)).toBe(true);
    expect(awaitingApproval(t("internal_review", "tanvi"), { ...tanvi, id: "sourabh" })).toBe(true);
  });
  it("counts peer review for the author but not for admins", () => {
    expect(awaitingApproval(t("internal_review", "saail"), nikita)).toBe(true);
    expect(awaitingApproval(t("internal_review", "saail"), tanvi)).toBe(false);
    expect(awaitingApproval(t("internal_review", "nikita"), nikita)).toBe(false);
  });
  it("includes submitted work, excludes other people's work and non-review stages", () => {
    expect(awaitingApproval(t("writing_scripting", "nikita", { status: "in_review" }), nikita)).toBe(true);
    expect(awaitingApproval(t("writing_scripting", "nikita", { status: "in_review" }), tanvi)).toBe(true);
    expect(awaitingApproval(t("asset_creation", "tanvi"), nikita)).toBe(false);
    expect(awaitingApproval(t("internal_review", "tanvi"), { ...nikita, id: "saail" })).toBe(false);
    expect(awaitingApproval(t("internal_review", "tanvi", { status: "done" }), nikita)).toBe(false);
  });
});

describe("task requests (D-033)", () => {
  const req: ActionContext = { ...base, status: "requested", activeStage: null, hasNextStage: true, hasEarlierDoneStage: false };
  it("a requester can only edit or withdraw; no workflow action", () => {
    expect([...availableActions(req)].sort()).toEqual(["cancel", "edit"]);
  });
  it("admins accept or decline", () => {
    const a = availableActions({ ...req, meId: "tanvi", isAdmin: true });
    expect(a.has("accept_request") && a.has("decline_request")).toBe(true);
    expect(a.has("hand_off") || a.has("submit") || a.has("pick_up")).toBe(false);
  });
});

describe("Recycle Bin and never-accepted requests (audit fix)", () => {
  it("a task in the Recycle Bin offers no actions, even to an admin", () => {
    expect(availableActions({ ...base, isAdmin: true, meId: "boss", removed: true }).size).toBe(0);
  });
  it("a cancelled task can be reopened by an admin, unless it was a request that was never accepted", () => {
    expect(availableActions({ ...base, status: "cancelled", isAdmin: true, meId: "boss" }).has("reopen")).toBe(true);
    expect(availableActions({ ...base, status: "cancelled", isAdmin: true, meId: "boss", neverAccepted: true }).has("reopen")).toBe(false);
    expect(availableActions({ ...base, status: "cancelled" }).has("reopen")).toBe(false);
  });
});

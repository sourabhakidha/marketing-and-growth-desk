import { describe, expect, it } from "vitest";
import { availableActions, type ActionContext } from "./permissions.ts";

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
});

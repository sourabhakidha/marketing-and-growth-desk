import { describe, expect, it } from "vitest";
import { accountLabel, usernameToLoginEmail } from "./username.ts";

describe("username login", () => {
  it("maps usernames case-insensitively to the internal login address", () => {
    expect(usernameToLoginEmail("  Sourabh ")).toBe("sourabh@marketing-os.invalid");
    expect(usernameToLoginEmail("saail")).toBe("saail@marketing-os.invalid");
  });
  it("rejects anything that is not a username", () => {
    expect(usernameToLoginEmail("tanvi@akidha.in")).toBeNull();
    expect(usernameToLoginEmail("two words")).toBeNull();
    expect(usernameToLoginEmail("")).toBeNull();
  });
  it("labels accounts by username", () => {
    expect(accountLabel("nikita@marketing-os.invalid")).toBe("nikita");
    expect(accountLabel("someone@other.app")).toBe("someone@other.app");
  });
});

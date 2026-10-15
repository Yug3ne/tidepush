import { describe, expect, it } from "vitest";
import { dummyVerify, hashPassword, verifyPassword } from "../src/auth/password";

describe("password hashing", () => {
  it("hashes in the documented format and verifies", async () => {
    const stored = await hashPassword("a long enough password");
    expect(stored).toMatch(/^pbkdf2-sha256\$100000\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    expect(await verifyPassword("a long enough password", stored)).toBe(true);
    expect(await verifyPassword("a long enough passworD", stored)).toBe(false);
    expect(await verifyPassword("", stored)).toBe(false);
  });

  it("salts every hash", async () => {
    expect(await hashPassword("same password here")).not.toBe(await hashPassword("same password here"));
  });

  it("rejects malformed or out-of-range stored hashes", async () => {
    const stored = await hashPassword("pw-pw-pw-pw-pw");
    const [, , salt, hash] = stored.split("$");
    expect(await verifyPassword("pw-pw-pw-pw-pw", `bcrypt$100000$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("pw-pw-pw-pw-pw", `pbkdf2-sha256$100001$${salt}$${hash}`)).toBe(false);
    expect(await verifyPassword("pw-pw-pw-pw-pw", `pbkdf2-sha256$100000$${salt}`)).toBe(false);
    expect(await verifyPassword("pw-pw-pw-pw-pw", `pbkdf2-sha256$100000$${salt}$${hash!.slice(0, 20)}`)).toBe(false);
  });

  it("dummyVerify always fails", async () => {
    expect(await dummyVerify("anything at all")).toBe(false);
  });
});

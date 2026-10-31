import { signToken, verifyToken } from "./token.js";

const secret = "a-test-secret-that-is-long-enough-123456";

describe("bearer tokens", () => {
  it("round-trips the user id", () => {
    const token = signToken("alice", secret, 60, 1_000_000);
    expect(verifyToken(token, secret, 1_000_000)).toBe("alice");
  });

  it("rejects a token signed with another secret", () => {
    const token = signToken("alice", secret, 60, 1_000_000);
    expect(() => verifyToken(token, "another-secret-that-is-also-long-enough", 1_000_000)).toThrow(/Invalid token/);
  });

  it("rejects a tampered payload", () => {
    const token = signToken("alice", secret, 60, 1_000_000);
    const [prefix = "", payload = "", signature = ""] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "mallory", exp: 9_999_999_999 })).toString("base64url");
    expect(() => verifyToken(`${prefix}.${forged}.${signature}`, secret, 1_000_000)).toThrow(/Invalid token/);
    expect(payload.length).toBeGreaterThan(0);
  });

  it("rejects expired tokens", () => {
    const token = signToken("alice", secret, 60, 1_000_000);
    expect(() => verifyToken(token, secret, 1_000_000 + 61_000)).toThrow(/expired/);
  });

  it("refuses to sign for an invalid user id", () => {
    expect(() => signToken("bad user", secret, 60)).toThrow(/Invalid user id/);
  });
});

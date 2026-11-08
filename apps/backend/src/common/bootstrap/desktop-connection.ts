import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { WindowsSecretProtector } from "../../modules/providers/secret-protector.js";
import { signToken } from "../../modules/auth/token.js";

/** The native desktop discovers only DPAPI ciphertext; neither the signing secret nor a plaintext token is written. */
export async function prepareDesktopConnection(): Promise<{
  publish: (secret: string) => Promise<void>;
}> {
  if (process.platform !== "win32" || !process.env["LOCALAPPDATA"])
    throw new Error("Automatic desktop authentication requires Windows");
  const folder = join(process.env["LOCALAPPDATA"], "Movynta");
  await mkdir(folder, { recursive: true });
  const vault = new WindowsSecretProtector();
  if (!process.env["AUTH_SECRET"]) {
    const path = join(folder, "auth.dpapi");
    try {
      process.env["AUTH_SECRET"] = await vault.unprotect(await readFile(path, "utf8"), "movynta:auth");
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")) throw error;
      const secret = randomBytes(48).toString("base64url");
      await writeFile(path, await vault.protect(secret, "movynta:auth"), {
        flag: "wx",
        mode: 0o600,
      });
      process.env["AUTH_SECRET"] = secret;
    }
  }
  process.env["DATABASE_URL"] ??= `file:${join(folder, "movynta.sqlite")}`;
  return {
    publish: async (secret: string) => {
      if (!secret) throw new Error("Backend authentication is unavailable");
      const token = signToken("desktop-local", secret, 8 * 60 * 60);
      await writeFile(join(folder, "connection.dpapi"), await vault.protect(token, "movynta:desktop-connection"), {
        mode: 0o600,
      });
    },
  };
}

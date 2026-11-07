import { execFile } from "node:child_process";
import { Injectable } from "@nestjs/common";
import { ServiceUnavailableError } from "../../common/errors/app-error.js";

/** The injection token for the component that encrypts secrets. */
export const SECRET_PROTECTOR = Symbol("SECRET_PROTECTOR");
/** Encrypts and decrypts secrets, bound to a purpose so one kind cannot be read as another. */
export interface SecretProtector {
  protect(value: string, scope: string): Promise<string>;
  unprotect(value: string, scope: string): Promise<string>;
}

/** DPAPI CurrentUser: no application master key or plaintext credential file. Secrets travel over stdin only. */
@Injectable()
export class WindowsSecretProtector implements SecretProtector {
  protect(value: string, scope: string): Promise<string> {
    return this.transform(value, scope, false);
  }
  unprotect(value: string, scope: string): Promise<string> {
    return this.transform(value, scope, true);
  }

  private transform(value: string, scope: string, decrypt: boolean): Promise<string> {
    if (process.platform !== "win32") throw new ServiceUnavailableError("Credential storage requires Windows DPAPI");
    const operation = decrypt ? "Unprotect" : "Protect";
    const script = `Add-Type -AssemblyName System.Security; $p = [Console]::In.ReadToEnd() | ConvertFrom-Json; $v = [Convert]::FromBase64String($p.value); $e = [Text.Encoding]::UTF8.GetBytes($p.scope); $r = [Security.Cryptography.ProtectedData]::${operation}($v, $e, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
    const input = decrypt ? value : Buffer.from(value, "utf8").toString("base64");
    return new Promise((resolve, reject) => {
      const child = execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", script],
        { windowsHide: true, timeout: 10000, maxBuffer: 32768 },
        (error, stdout) => {
          if (error) {
            reject(new ServiceUnavailableError("Credential vault could not be accessed"));
            return;
          }
          const result = stdout.trim();
          resolve(decrypt ? Buffer.from(result, "base64").toString("utf8") : result);
        },
      );
      child.stdin?.on("error", () => reject(new ServiceUnavailableError("Credential vault could not be accessed")));
      child.stdin?.end(JSON.stringify({ value: input, scope }));
    });
  }
}

use std::io::Write;
use std::process::{Command, Stdio};

#[tauri::command]
pub async fn backend_access() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(read_access)
        .await
        .map_err(|_| "Could not access the local backend".to_string())?
}

#[cfg(windows)]
fn read_access() -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let folder = std::env::var_os("LOCALAPPDATA").ok_or("Local app data is unavailable")?;
    let path = std::path::PathBuf::from(folder)
        .join("Movynta")
        .join("connection.dpapi");
    let protected =
        std::fs::read_to_string(path).map_err(|_| "Start the Movynta backend to connect")?;
    if protected.len() > 32768 {
        return Err("Invalid backend connection record".into());
    }
    let script = "Add-Type -AssemblyName System.Security; $v = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim()); $e = [Text.Encoding]::UTF8.GetBytes('movynta:desktop-connection'); $r = [Security.Cryptography.ProtectedData]::Unprotect($v, $e, [Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Text.Encoding]::UTF8.GetString($r))";
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "Could not open the Windows credential vault")?;
    child
        .stdin
        .take()
        .ok_or("Credential vault input is unavailable")?
        .write_all(protected.as_bytes())
        .map_err(|_| "Could not read backend credentials")?;
    let output = child
        .wait_with_output()
        .map_err(|_| "Credential vault failed")?;
    if !output.status.success() {
        return Err("Could not unlock backend credentials".into());
    }
    String::from_utf8(output.stdout).map_err(|_| "Invalid backend credentials".into())
}

#[cfg(not(windows))]
fn read_access() -> Result<String, String> {
    Err("Automatic backend connection requires Windows".into())
}

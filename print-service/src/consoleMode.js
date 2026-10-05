// src/consoleMode.js
// ─────────────────────────────────────────────────────────────────────────────
// Windows console "QuickEdit" mode: one click (or text selection) inside the
// print-service window PAUSES the program — Node's console writes are
// synchronous on Windows, so the first log line after the click blocks the
// whole process: no socket, no retry sweep, no printing, until someone presses
// a key in that window. Staff click on the black window all the time, and the
// symptom is exactly "sometimes it prints, sometimes nothing for minutes".
//
// Turned off at startup for THIS window only (the console mode belongs to the
// window, which a child process started without its own window shares), via a
// tiny PowerShell call — no native module. Best-effort: any failure is ignored.
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from "child_process";

const ENABLE_QUICK_EDIT_MODE = 0x40;
const ENABLE_EXTENDED_FLAGS = 0x80; // required for the QuickEdit bit to apply

const SCRIPT = [
  "$s='[DllImport(\"kernel32.dll\")]public static extern IntPtr GetStdHandle(int h);",
  "[DllImport(\"kernel32.dll\")]public static extern bool GetConsoleMode(IntPtr h,out uint m);",
  "[DllImport(\"kernel32.dll\")]public static extern bool SetConsoleMode(IntPtr h,uint m);';",
  "$k=Add-Type -MemberDefinition $s -Name ConsoleModeK -Namespace SohojPrint -PassThru;",
  "$h=$k::GetStdHandle(-10);$m=0;",
  `if($k::GetConsoleMode($h,[ref]$m)){[void]$k::SetConsoleMode($h,(($m -band (-bnot ${ENABLE_QUICK_EDIT_MODE})) -bor ${ENABLE_EXTENDED_FLAGS}))}`,
].join("");

/** → Promise<boolean> — true when the PowerShell call ran (Windows + a real console). */
export const disableQuickEdit = ({ platform = process.platform, isTTY = process.stdin.isTTY, spawnImpl = spawn } = {}) => {
  if (platform !== "win32" || !isTTY) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      // stdin inherited = the same console input buffer as this window.
      const child = spawnImpl("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT], {
        stdio: ["inherit", "ignore", "ignore"],
      });
      child.on("error", () => resolve(false));
      child.on("exit", (code) => resolve(code === 0));
    } catch {
      resolve(false);
    }
  });
};

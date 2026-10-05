param(
  [ValidateSet('capture', 'background', 'foreground')][string]$Action,
  [int]$BrowserProcessId = 0,
  [long]$PreviousWindow = 0
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class GeoBrowserWindow {
  public delegate bool Callback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr window);
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window, StringBuilder name, int size);
  [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr window);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  public static int Place(uint process, bool foreground, IntPtr previous) {
    int found = 0;
    EnumWindows((window, parameter) => {
      uint owner; GetWindowThreadProcessId(window, out owner);
      var name = new StringBuilder(256); GetClassName(window, name, 256);
      if (owner != process || name.ToString() != "Chrome_WidgetWin_1" || GetWindowTextLength(window) == 0) return true;
      found++;
      ShowWindow(window, foreground ? 9 : 4);
      if (foreground) SetForegroundWindow(window);
      else SetWindowPos(window, new IntPtr(1), 0, 0, 0, 0, 0x0013);
      return true;
    }, IntPtr.Zero);
    uint activeOwner; GetWindowThreadProcessId(GetForegroundWindow(), out activeOwner);
    if (!foreground && activeOwner == process && previous != IntPtr.Zero && IsWindow(previous)) SetForegroundWindow(previous);
    return found;
  }
}
'@
if ($Action -eq 'capture') {
  [GeoBrowserWindow]::GetForegroundWindow().ToInt64()
  exit
}
$geoBrowser = Get-Process -Id $BrowserProcessId -ErrorAction Stop
if ($geoBrowser.ProcessName -notin @('msedge', 'chrome', 'chromium')) { throw 'Target is not a supported browser process.' }
for ($geoAttempt = 0; $geoAttempt -lt 10; $geoAttempt++) {
  if ([GeoBrowserWindow]::Place($BrowserProcessId, $Action -eq 'foreground', [IntPtr]$PreviousWindow) -gt 0) { exit }
  Start-Sleep -Milliseconds 200
}
throw 'The account browser window was not found on this desktop.'

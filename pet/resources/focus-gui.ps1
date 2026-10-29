# 准确地把"已经打开的 DSH 界面"标签叫到前台。
#
# 只靠标题会误伤（文档页、GitHub 页、开放平台页也可能含 DeepSeek），所以分两级：
#   1. 候选：浏览器窗口标题含标记（默认 DeepSeek Harness）→ 枚举其中的标签页
#   2. 校验：逐个选中候选标签，读地址栏 URL，必须命中 -ExpectHost（如 127.0.0.1:3080）
#      不命中就回滚到原来的标签，继续试下一个；全都不中就报 NOTFOUND
#
# 输出（stdout 最后一行）：
#   FOCUSED <hwnd> <进程名> <窗口标题> URL=<地址>     找到并前台化
#   NOTFOUND                                         没有匹配的标签
#
# 只用 Windows 自带能力（Win32 + UI Automation），兼容 PowerShell 5.1 / 7。
param(
  [string]$Markers = 'DeepSeek Harness',
  [string]$ExpectHost = '127.0.0.1:3080',
  [string]$BrowserProcesses = 'msedge,chrome,firefox,brave,vivaldi,opera,chromium,thorium'
)

Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class GuiFocus {
  public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr extra);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();

  public static List<IntPtr> FindByTitle(string marker) {
    List<IntPtr> found = new List<IntPtr>();
    EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
      if (!IsWindowVisible(hWnd)) return true;
      int length = GetWindowTextLength(hWnd);
      if (length <= 0) return true;
      StringBuilder sb = new StringBuilder(length + 2);
      GetWindowText(hWnd, sb, sb.Capacity);
      string title = sb.ToString();
      if (title.IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0) found.Add(hWnd);
      return true;
    }, IntPtr.Zero);
    return found;
  }

  public static string TitleOf(IntPtr hWnd) {
    int length = GetWindowTextLength(hWnd);
    if (length <= 0) return "";
    StringBuilder sb = new StringBuilder(length + 2);
    GetWindowText(hWnd, sb, sb.Capacity);
    return sb.ToString();
  }

  public static void ForceForeground(IntPtr hWnd) {
    if (IsIconic(hWnd)) ShowWindow(hWnd, 9); // SW_RESTORE
    IntPtr foreground = GetForegroundWindow();
    uint targetPid;
    uint foregroundPid;
    uint targetThread = GetWindowThreadProcessId(hWnd, out targetPid);
    uint foregroundThread = foreground == IntPtr.Zero ? 0 : GetWindowThreadProcessId(foreground, out foregroundPid);
    uint self = GetCurrentThreadId();
    bool attached = false;
    try {
      if (foregroundThread != 0 && foregroundThread != self) attached = AttachThreadInput(self, foregroundThread, true);
      SetForegroundWindow(hWnd);
      ShowWindow(hWnd, 5); // SW_SHOW
    } finally {
      if (attached) AttachThreadInput(self, foregroundThread, false);
    }
  }

  public static string ProcessNameOf(IntPtr hWnd) {
    try {
      uint processId;
      GetWindowThreadProcessId(hWnd, out processId);
      return System.Diagnostics.Process.GetProcessById((int)processId).ProcessName;
    } catch (Exception) {
      return "?";
    }
  }
}
'@

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

$browsers = $BrowserProcesses.Split(',') | ForEach-Object { $_.Trim().ToLowerInvariant() }
$markerList = $Markers.Split(',') | ForEach-Object { $_.Trim() } | Where-Object { $_ }

function Get-Tabs {
  param($root)
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem)
  return $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
}

function Get-AddressBarValue {
  param($root)
  # 地址栏在不同浏览器/语言里叫 "地址和搜索栏" / "Address and search bar"，
  # 所以主要靠"是个 Edit 且值像 URL"来兜底。
  $cond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit)
  $edits = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
  foreach ($edit in $edits) {
    try {
      $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).Current.Value
      if (-not $value) { continue }
      if ($value -match '^(https?://|127\.0\.0\.1|localhost)') { return $value }
      if ($edit.Current.Name -match '地址|Address|搜索') { return $value }
    } catch { }
  }
  return ''
}

function Select-Tab {
  param($tab)
  try {
    $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    return $true
  } catch {
    try {
      $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      return $true
    } catch { return $false }
  }
}

function Tab-IsSelected {
  param($tab)
  try {
    return [bool]$tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Current.IsSelected
  } catch { return $false }
}

# ---- 收集候选窗口（按标记优先级） ----
$windows = @()
foreach ($marker in $markerList) {
  foreach ($handle in [GuiFocus]::FindByTitle($marker)) {
    $name = [GuiFocus]::ProcessNameOf($handle)
    if ($browsers -notcontains $name.ToLowerInvariant()) { continue }
    if ($windows | Where-Object { $_.Handle -eq $handle }) { continue }
    $windows += [pscustomobject]@{ Handle = $handle; Process = $name; Title = [GuiFocus]::TitleOf($handle) }
  }
}

if ($windows.Count -eq 0) {
  'NOTFOUND'
  exit 0
}

# ---- 逐个窗口、逐个标签：选中 → 读地址栏 → 校验 host ----
foreach ($window in $windows) {
  $root = $null
  try { $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle) } catch { }
  if (-not $root) { continue }

  $tabs = Get-Tabs -root $root
  if (-not $tabs -or $tabs.Count -eq 0) { continue }

  # 记住原本选中的标签，误试后要还原
  $original = $null
  foreach ($tab in $tabs) {
    if (Tab-IsSelected -tab $tab) { $original = $tab; break }
  }

  foreach ($tab in $tabs) {
    $name = $tab.Current.Name
    if (-not $name) { continue }
    $hit = $false
    foreach ($marker in $markerList) {
      if ($name.IndexOf($marker, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) { $hit = $true; break }
    }
    if (-not $hit) { continue }

    if (-not (Select-Tab -tab $tab)) { continue }
    Start-Sleep -Milliseconds 220

    $url = ''
    try { $url = Get-AddressBarValue -root $root } catch { $url = '' }

    if ($url -and ($url.IndexOf($ExpectHost, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)) {
      [GuiFocus]::ForceForeground($window.Handle)
      "FOCUSED $($window.Handle) $($window.Process) $($window.Title) URL=$url"
      exit 0
    }

    # 这个标签不是本机 DSH：还原原来那个，继续找
    if ($original) { [void](Select-Tab -tab $original) }
    Start-Sleep -Milliseconds 120
  }
}

'NOTFOUND'
exit 0

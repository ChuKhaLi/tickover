param([string]$out)
Add-Type -Name W -Namespace N -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern System.IntPtr GetConsoleWindow();
[DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
[DllImport("kernel32.dll")] public static extern uint GetConsoleProcessList(uint[] list, uint count);
'@
$h = [N.W]::GetConsoleWindow()
$pids = New-Object 'uint32[]' 16
$n = [N.W]::GetConsoleProcessList($pids, 16)
$names = ($pids[0..([int]$n - 1)] | ForEach-Object { (Get-Process -Id $_ -ErrorAction SilentlyContinue).ProcessName }) -join ','
"hwnd=$h visible=$([N.W]::IsWindowVisible($h)) consoleProcs=$n [$names]" | Out-File -Append -Encoding utf8 $out
Start-Sleep -Milliseconds 200
Write-Output 'slow line'

# 一键部署：先停 DSH，再覆盖安装目录，最后启动 DSH NEXT 并校验。
# 用法: powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
# 选项: -SkipStop 只部署不停止; -NoStart 只停+部署不起; -InstallDir 自定义安装目录
param(
  [string]$InstallDir = 'D:\Downloads\DSH\plugins\dsh-auto-router',
  [string]$HostExe = 'D:\SoftWare\DSH\lastest-officially\DSH NEXT.exe',
  [switch]$SkipStop,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

# Only this host's processes are touched. Other DSH versions the user runs
# alongside (low/high) must never be stopped or restarted here.
if (-not $SkipStop) {
  Write-Host "==> 停止本次更新的宿主: $HostExe"
  $hostProcs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe }
  if (-not $hostProcs) {
    $name = [System.IO.Path]::GetFileNameWithoutExtension($HostExe)
    $hostProcs = Get-Process -Name $name -ErrorAction SilentlyContinue
  }
  $hostProcs | Stop-Process -Force -Confirm:$false
  Start-Sleep -Seconds 3
  $left = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe }
  if ($left) { throw '本次宿主未能全部退出, 已中止部署' }
}

Write-Host "==> 部署到 $InstallDir"
foreach ($dir in @('lib', 'docs', 'locale', 'src', 'test', 'scripts')) {
  $dst = Join-Path $InstallDir $dir
  if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }
  Copy-Item -Path (Join-Path $root "$dir\*") -Destination $dst -Force -Recurse
}
foreach ($file in @('package.json', 'CHANGELOG.md', 'README.md')) {
  Copy-Item -LiteralPath (Join-Path $root $file) -Destination (Join-Path $InstallDir $file) -Force
}

$version = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
$libCount = (Get-ChildItem -LiteralPath (Join-Path $InstallDir 'lib') -Filter *.js | Measure-Object).Count
Write-Host "==> 部署完成: version=$version, lib=$libCount js"

if (-not $NoStart) {
  Write-Host "==> 启动宿主: $HostExe"
  Start-Process -FilePath $HostExe
  Start-Sleep -Seconds 8
  $running = (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe } | Measure-Object).Count
  Write-Host "==> 宿主进程数: $running"
}

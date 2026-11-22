# 一键部署：先停 DSH，再覆盖安装目录，最后启动 DSH NEXT 并校验。
# 用法: powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
# 选项: -SkipStop 只部署不停止; -NoStart 只停+部署不起; -InstallDir 自定义安装目录
param(
  [string]$InstallDir = 'D:\Downloads\DSH\plugins\dsh-auto-router',
  [string]$NextExe = 'D:\SoftWare\DSH\lastest-officially\DSH NEXT.exe',
  [switch]$SkipStop,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

if (-not $SkipStop) {
  Write-Host '==> 停止 DSH 进程 (NEXT / 经典版)'
  foreach ($name in @('DSH NEXT', 'DeepSeek Harness')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -Confirm:$false
  }
  Start-Sleep -Seconds 3
  $left = Get-Process -Name 'DSH NEXT', 'DeepSeek Harness' -ErrorAction SilentlyContinue
  if ($left) { throw 'DSH 进程未能全部退出, 已中止部署' }
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
  Write-Host '==> 启动 DSH NEXT'
  Start-Process -FilePath $NextExe
  Start-Sleep -Seconds 8
  $running = (Get-Process -Name 'DSH NEXT' -ErrorAction SilentlyContinue | Measure-Object).Count
  Write-Host "==> DSH NEXT 进程数: $running"
}

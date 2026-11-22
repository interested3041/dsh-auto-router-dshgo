# 自助更新：下载 GitHub Release 源码包 -> 停 DSH -> 覆盖安装目录 -> 启动 NEXT -> 校验。
# 由插件面板「更新」按钮以分离进程调用, 宿主可被安全重启。不在运行中覆盖文件。
param(
  [Parameter(Mandatory = $true)][string]$Tag,
  [string]$Repo = 'interested3041/dsh-auto-router-dshgo',
  [string]$InstallDir = 'D:\Downloads\DSH\plugins\dsh-auto-router-dshgo',
  [string]$HostExe = 'D:\SoftWare\DSH\lastest-officially\DSH NEXT.exe'
)
$ErrorActionPreference = 'Stop'
$ver = $Tag -replace '^v', ''
$tmp = Join-Path $env:TEMP ("dsh-selfupdate-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
$zip = Join-Path $tmp 'src.zip'
$url = "https://github.com/$Repo/archive/refs/tags/v$ver.zip"

Write-Host "==> 下载 $url"
try {
  Invoke-WebRequest -Uri $url -OutFile $zip -Proxy 'http://127.0.0.1:7897' -TimeoutSec 120 -UseBasicParsing
} catch {
  Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 120 -UseBasicParsing
}
Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
$root = Get-ChildItem -Path $tmp -Directory | Where-Object { Test-Path (Join-Path $_.FullName 'package.json') } | Select-Object -First 1
if (-not $root) { throw '解压后未找到 package.json, 更新中止' }
$src = $root.FullName

Write-Host "==> 停止本次更新的宿主: $HostExe"
$hostProcs = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe }
if (-not $hostProcs) {
  $name = [System.IO.Path]::GetFileNameWithoutExtension($HostExe)
  $hostProcs = Get-Process -Name $name -ErrorAction SilentlyContinue
}
$hostProcs | Stop-Process -Force -Confirm:$false
Start-Sleep -Seconds 3
$left = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe }
if ($left) { throw '本次宿主未能全部退出, 已中止更新' }

Write-Host "==> 部署 v$ver 到 $InstallDir"
foreach ($dir in @('lib', 'docs', 'locale', 'src', 'test', 'scripts')) {
  $from = Join-Path $src $dir
  if (-not (Test-Path -LiteralPath $from)) { continue }
  $dst = Join-Path $InstallDir $dir
  if (-not (Test-Path -LiteralPath $dst)) { New-Item -ItemType Directory -Path $dst | Out-Null }
  Copy-Item -Path (Join-Path $from '*') -Destination $dst -Force -Recurse
}
foreach ($file in @('package.json', 'CHANGELOG.md', 'README.md')) {
  $from = Join-Path $src $file
  if (Test-Path -LiteralPath $from) { Copy-Item -LiteralPath $from -Destination (Join-Path $InstallDir $file) -Force }
}

$version = (Get-Content -LiteralPath (Join-Path $InstallDir 'package.json') -Raw | ConvertFrom-Json).version
Write-Host "==> 部署完成: version=$version"

Write-Host "==> 启动宿主: $HostExe"
Start-Process -FilePath $HostExe
Start-Sleep -Seconds 8
$running = (Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $HostExe } | Measure-Object).Count
Write-Host "==> 宿主进程数: $running"
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue

<#
  Fetches FREE OpenStreetMap-based map data for India into public/map/ so the Map page works,
  and can be saved on the device for use with no internet.

  What it downloads (read before running):
    1. The official go-pmtiles command-line tool from github.com/protomaps/go-pmtiles (a release zip).
       It is extracted into a temporary folder OUTSIDE this project and run once to cut out India.
    2. An India extract from the public Protomaps world build (build.protomaps.com), written to
       public/map/india.pmtiles. Only the tiles inside the bounding box are fetched (HTTP range requests).
    3. Label font files (Noto Sans) from protomaps.github.io/basemaps-assets into public/map/fonts/.

  Data licence: (c) OpenStreetMap contributors, ODbL. Keep the attribution that the map shows.
  Protomaps' public builds are meant for evaluation and personal projects. For a launched product
  with real traffic, host your own copy (this file works as-is on any static host) and check their terms.

  Usage (from the project root):
    powershell -ExecutionPolicy Bypass -File scripts/get-offline-map.ps1
    powershell -File scripts/get-offline-map.ps1 -MaxZoom 10        # more detail, bigger file
    powershell -File scripts/get-offline-map.ps1 -Bbox "76,26,78,29.5" -Name delhi-corridor.pmtiles -MaxZoom 13
#>
param(
  [string]$Bbox = "68.1,6.5,97.5,35.7",   # India: west,south,east,north
  [int]$MaxZoom = 9,                       # 9 is roughly a few hundred MB for India; each +1 is ~2-3x larger
  [string]$Name = "india.pmtiles",
  [string]$ToolVersion = "1.31.2"
)
$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$out = Join-Path $root "public\map"
New-Item -ItemType Directory -Force $out | Out-Null

# --- 1. Tool, kept outside the project -------------------------------------------------------------
$tmp = Join-Path $env:TEMP "lrp-pmtiles-tool"
New-Item -ItemType Directory -Force $tmp | Out-Null
$exe = Join-Path $tmp "pmtiles.exe"
if (-not (Test-Path $exe)) {
  $zip = Join-Path $tmp "tool.zip"
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "x86_64" }
  $url = "https://github.com/protomaps/go-pmtiles/releases/download/v$ToolVersion/go-pmtiles_${ToolVersion}_Windows_$arch.zip"
  Write-Host "Downloading pmtiles tool: $url"
  Invoke-WebRequest $url -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $tmp -Force
}

# --- 2. Latest world build -------------------------------------------------------------------------
$build = $null
foreach ($i in 0..10) {
  $d = (Get-Date).AddDays(-$i).ToString("yyyyMMdd")
  try {
    $r = Invoke-WebRequest "https://build.protomaps.com/$d.pmtiles" -Method Head -UseBasicParsing -TimeoutSec 20
    if ($r.StatusCode -eq 200) { $build = "https://build.protomaps.com/$d.pmtiles"; break }
  } catch { }
}
if (-not $build) { throw "Could not find a recent Protomaps build. Check https://maps.protomaps.com/builds/" }
Write-Host "Using build: $build"

$dest = Join-Path $out $Name
Write-Host "Extracting bbox $Bbox up to zoom $MaxZoom -> $dest"
& $exe extract $build $dest --bbox=$Bbox --maxzoom=$MaxZoom
if ($LASTEXITCODE -ne 0) { throw "pmtiles extract failed" }
"{0:N1} MB written" -f ((Get-Item $dest).Length / 1MB) | Write-Host

# --- 3. Fonts for labels ---------------------------------------------------------------------------
$fontBase = "https://protomaps.github.io/basemaps-assets/fonts"
foreach ($font in @("Noto Sans Regular", "Noto Sans Medium", "Noto Sans Italic")) {
  $dir = Join-Path $out "fonts\$font"
  New-Item -ItemType Directory -Force $dir | Out-Null
  # Keep in sync with GLYPH_RANGES in src/lib/map/style.ts
  $ranges = @(); for ($i = 0; $i -lt 4096; $i += 256) { $ranges += "$i-$($i + 255)" }
  $ranges += @("8192-8447", "8448-8703", "64256-64511", "65024-65279", "65280-65535")
  foreach ($range in $ranges) {
    $file = Join-Path $dir "$range.pbf"
    if (-not (Test-Path $file)) {
      # A few ranges may not exist for a font; skip those instead of aborting the whole run.
      try { Invoke-WebRequest ("$fontBase/" + [uri]::EscapeDataString($font) + "/$range.pbf") -OutFile $file -UseBasicParsing }
      catch { Write-Host "skipped $font $range" }
    }
  }
}
Write-Host "Done. Start the app, sign in, open Map, and press 'Save map for offline use'."

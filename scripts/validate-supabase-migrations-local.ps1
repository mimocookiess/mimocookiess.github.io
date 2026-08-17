$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$supabaseRoot = Join-Path $repoRoot "supabase"
$harnessRoot = Join-Path $supabaseRoot ".temp\phase2-local-harness"
$expectedHarnessRoot = [System.IO.Path]::GetFullPath($harnessRoot)
$migrationsTarget = Join-Path $harnessRoot "supabase\migrations"

if (
  -not $expectedHarnessRoot.StartsWith(
    [System.IO.Path]::GetFullPath((Join-Path $supabaseRoot ".temp")) +
      [System.IO.Path]::DirectorySeparatorChar
  ) -or
  (Split-Path -Leaf $expectedHarnessRoot) -ne "phase2-local-harness"
) {
  throw "Local harness path validation failed."
}

$existingConfig = Join-Path $expectedHarnessRoot "supabase\config.toml"

if (Test-Path -LiteralPath $existingConfig) {
  & supabase stop --workdir $expectedHarnessRoot --no-backup | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Could not stop the existing isolated local harness."
  }
}

if (Test-Path -LiteralPath $expectedHarnessRoot) {
  Remove-Item -LiteralPath $expectedHarnessRoot -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $migrationsTarget | Out-Null

$configSource = Join-Path $supabaseRoot "local-bootstrap\config.toml"
$configTarget = Join-Path $harnessRoot "supabase\config.toml"
Copy-Item -LiteralPath $configSource -Destination $configTarget

$baselineSource = Join-Path $supabaseRoot (
  "local-bootstrap\20260801000000_pre_versioned_schema.sql"
)
Copy-Item -LiteralPath $baselineSource -Destination $migrationsTarget

$migrationsSource = Join-Path $supabaseRoot "migrations"
Get-ChildItem -LiteralPath $migrationsSource -Filter "*.sql" -File |
  Sort-Object Name |
  Copy-Item -Destination $migrationsTarget

& supabase start --workdir $harnessRoot | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "supabase start failed for the isolated local harness."
}

& supabase db reset --local --workdir $harnessRoot
if ($LASTEXITCODE -ne 0) {
  throw "supabase db reset failed for the isolated local harness."
}

Write-Output "Local migration chain validated in: $expectedHarnessRoot"

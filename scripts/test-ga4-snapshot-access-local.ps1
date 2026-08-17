$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$harnessRoot = Join-Path $repoRoot "supabase\.temp\phase2-local-harness"
$productId = "00000000-0000-4000-8000-00000000c501"
$orderId = "00000000-0000-4000-8000-00000000c502"
$itemId = "00000000-0000-4000-8000-00000000c503"

$insertSql = @"
with product_fixture as (
  insert into public.products (
    id, slug, name, price, image_url, stock
  ) values (
    '$productId', 'ga4-regression-product', 'GA4 Regression Product',
    10, 'synthetic://local', 10
  )
  returning id
), order_fixture as (
  insert into public.orders (
    id, customer_name, delivery_method, payment_method, subtotal,
    status, completed_at, ga_client_id, ga_session_id
  ) values (
    '$orderId', 'Teste Local', 'Retirada', 'Pix', 20,
    'completed', now(), '123456789.1786900000', '1786900000'
  )
  returning id
), item_fixture as (
  insert into public.order_items (
    id, order_id, product_id, product_slug, product_name,
    unit_price, quantity
  )
  select
    '$itemId', order_fixture.id, product_fixture.id,
    'ga4-regression-product', 'GA4 Regression Product', 10, 2
  from order_fixture
  cross join product_fixture
  returning id
)
select
  order_fixture.id::text as order_id,
  (select count(*) from item_fixture) as item_count
from order_fixture;
"@

try {
  $fixtureResult = & supabase db query --local --workdir $harnessRoot `
    --output json $insertSql | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not create the synthetic GA4 snapshot fixture."
  }

  $fixture = $fixtureResult.rows[0]
  if ($fixture.order_id -ne $orderId -or $fixture.item_count -ne 1) {
    throw "Synthetic GA4 snapshot fixture validation failed."
  }

  $status = & supabase status --workdir $harnessRoot --output json |
    ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) {
    throw "Could not read the isolated harness status."
  }

  $serviceRoleKey = [string]$status.SERVICE_ROLE_KEY
  $select = @(
    "order_number",
    "subtotal",
    "delivery_fee",
    "total",
    "status",
    "completed_at",
    "ga_client_id",
    "ga_session_id",
    "order_items(product_slug,product_name,unit_price,quantity)"
  ) -join ","
  $url = ([string]$status.API_URL).TrimEnd("/") +
    "/rest/v1/orders?select=" + [uri]::EscapeDataString($select) +
    "&id=eq." + $orderId
  $headers = @{
    apikey = $serviceRoleKey
    Authorization = "Bearer $serviceRoleKey"
    Accept = "application/vnd.pgrst.object+json"
  }

  try {
    $response = Invoke-WebRequest -UseBasicParsing -Method Get `
      -Uri $url -Headers $headers -TimeoutSec 30
    $httpStatus = [int]$response.StatusCode
    $content = $response.Content
  } catch {
    if (-not $_.Exception.Response) {
      throw
    }

    $errorResponse = $_.Exception.Response
    $httpStatus = [int]$errorResponse.StatusCode
    $stream = $errorResponse.GetResponseStream()
    $memory = New-Object IO.MemoryStream
    try {
      $stream.CopyTo($memory)
      $content = $memory.ToArray()
    } finally {
      $stream.Dispose()
      $memory.Dispose()
    }
  } finally {
    $serviceRoleKey = $null
    $headers = $null
    $status = $null
  }

  if ($content -is [byte[]]) {
    $body = [Text.Encoding]::UTF8.GetString($content)
  } else {
    $body = [string]$content
  }

  if ($httpStatus -ne 200) {
    throw "GA4 snapshot query returned HTTP $httpStatus."
  }

  $snapshot = $body | ConvertFrom-Json
  if (
    $snapshot.status -ne "completed" -or
    $snapshot.subtotal -ne 20 -or
    $snapshot.total -ne 20 -or
    @($snapshot.order_items).Count -ne 1
  ) {
    throw "GA4 snapshot response validation failed."
  }

  Write-Output "GA4 snapshot PostgREST regression test passed."
} finally {
  & supabase db query --local --workdir $harnessRoot `
    "delete from public.orders where id = '$orderId';" | Out-Null
  & supabase db query --local --workdir $harnessRoot `
    "delete from public.products where id = '$productId';" | Out-Null

  $cleanupSql = @"
select
  (select count(*) from public.orders where id = '$orderId') as orders,
  (select count(*) from public.order_items where id = '$itemId') as items,
  (select count(*) from public.products where id = '$productId') as products;
"@
  $cleanupResult = & supabase db query --local --workdir $harnessRoot `
    --output json $cleanupSql | ConvertFrom-Json
  $cleanup = $cleanupResult.rows[0]
  if (
    $cleanup.orders -ne 0 -or
    $cleanup.items -ne 0 -or
    $cleanup.products -ne 0
  ) {
    throw "Synthetic GA4 snapshot fixture cleanup failed."
  }
}

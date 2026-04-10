# カレントディレクトリを静的配信（http://localhost:8080/）
# 使い方: .\serve.ps1   または  powershell -ExecutionPolicy Bypass -File .\serve.ps1
$ErrorActionPreference = 'Stop'
$port = 8080
$root = $PSScriptRoot
$listener = [System.Net.HttpListener]::new()
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()
Write-Host "Serving $root at http://localhost:$port/  (Ctrl+C で停止)" -ForegroundColor Green

function Get-Mime([string]$path) {
  switch -Regex ($path.ToLowerInvariant()) {
    '\.html$' { return 'text/html; charset=utf-8' }
    '\.css$'  { return 'text/css; charset=utf-8' }
    '\.js$'   { return 'text/javascript; charset=utf-8' }
    '\.csv$'  { return 'text/csv; charset=utf-8' }
    '\.json$' { return 'application/json; charset=utf-8' }
    '\.png$'  { return 'image/png' }
    '\.ico$'  { return 'image/x-icon' }
    default   { return 'application/octet-stream' }
  }
}

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    $req = $ctx.Request
    $res = $ctx.Response
    try {
      $rel = [Uri]::UnescapeDataString($req.Url.LocalPath.TrimStart('/'))
      if ([string]::IsNullOrEmpty($rel)) { $rel = 'index.html' }
      $full = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (-not $full.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
        $res.StatusCode = 403
      }
      elseif (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
        $res.StatusCode = 404
      }
      else {
        $bytes = [System.IO.File]::ReadAllBytes($full)
        $res.ContentType = Get-Mime $full
        $res.ContentLength64 = $bytes.LongLength
        $res.OutputStream.Write($bytes, 0, $bytes.Length)
      }
    }
    finally {
      $res.Close()
    }
  }
}
finally {
  $listener.Stop()
  $listener.Close()
}

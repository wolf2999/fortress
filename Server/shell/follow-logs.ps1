# Follow the four app logs until this window closes. Does not stop skynet.
$apps = @(
  @{ Tag = 'db';    Path = 'log\dbApp.log';    Color = 'Cyan' },
  @{ Tag = 'gate';  Path = 'log\gateApp.log';  Color = 'Green' },
  @{ Tag = 'login'; Path = 'log\loginApp.log'; Color = 'Yellow' },
  @{ Tag = 'world'; Path = 'log\worldApp.log'; Color = 'Magenta' }
)

$pos = @{}
$carry = @{}
foreach ($app in $apps) {
  $pos[$app.Path] = 0
  $carry[$app.Path] = ''
}

Write-Host 'following db, gate, login, world'

while ($true) {
  foreach ($app in $apps) {
    $path = $app.Path
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $fs = $null
    try {
      $fs = [System.IO.File]::Open(
        $path,
        [System.IO.FileMode]::Open,
        [System.IO.FileAccess]::Read,
        [System.IO.FileShare]::ReadWrite
      )
      $len = $fs.Length
      $at = [int64]$pos[$path]
      if ($len -lt $at) {
        $at = 0
        $carry[$path] = ''
      }
      if ($len -le $at) { continue }
      $fs.Position = $at
      $count = [int]($len - $at)
      $buf = New-Object byte[] $count
      $read = $fs.Read($buf, 0, $count)
      $pos[$path] = $at + $read
      $text = [System.Text.Encoding]::UTF8.GetString($buf, 0, $read)
      $carry[$path] = $carry[$path] + $text
      $parts = $carry[$path] -split "`n", -1
      if ($carry[$path].EndsWith("`n")) {
        $carry[$path] = ''
        $lines = $parts
      } else {
        $carry[$path] = $parts[-1]
        if ($parts.Length -le 1) { continue }
        $lines = $parts[0..($parts.Length - 2)]
      }
      foreach ($line in $lines) {
        $line = $line.TrimEnd("`r")
        Write-Host -NoNewline -ForegroundColor $app.Color "[$($app.Tag)] "
        Write-Host $line
      }
    } catch {
      Write-Host -ForegroundColor Red "[$($app.Tag)] $($_.Exception.Message)"
    } finally {
      if ($fs) { $fs.Dispose() }
    }
  }
  Start-Sleep -Milliseconds 200
}

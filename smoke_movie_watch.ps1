$ErrorActionPreference = "Continue"
$base = "http://127.0.0.1:3000"
$providers = @("flixhq","goku","sflix","himovies")
$query = "avengers"
foreach ($p in $providers) {
  Write-Host "`n=== $p ==="
  try {
    $search = Invoke-RestMethod -Uri "$base/movies/$p/$query?page=1" -Method Get
  } catch {
    Write-Host "Search failed"
    continue
  }

  $items = if ($null -ne $search.results) { @($search.results) } else { @($search) }
  if ($items.Count -eq 0) {
    Write-Host "No search results"
    continue
  }

  $passed = $false
  foreach ($candidate in ($items | Select-Object -First 8)) {
    $id = [string]$candidate.id
    if ([string]::IsNullOrWhiteSpace($id)) {
      continue
    }

    try {
      $info = Invoke-RestMethod -Uri "$base/movies/$p/info?id=$([uri]::EscapeDataString($id))" -Method Get
      $episodeId = ""
      if ($null -ne $info.episodes -and @($info.episodes).Count -gt 0) {
        $episodeId = [string](@($info.episodes)[0].id)
      }
      if ([string]::IsNullOrWhiteSpace($episodeId) -and $null -ne $info.episodeId) {
        $episodeId = [string]$info.episodeId
      }
      if ([string]::IsNullOrWhiteSpace($episodeId)) {
        continue
      }

      $watchUrl = "$base/movies/$p/watch?episodeId=$([uri]::EscapeDataString($episodeId))&mediaId=$([uri]::EscapeDataString($id))"
      $watch = Invoke-RestMethod -Uri $watchUrl -Method Get
      $sources = @($watch.sources)
      $direct = @($sources | Where-Object { [string]$_.url -match "\.(m3u8|mp4|mpd)(\?|$)" -or [string]$_.url -match "m3u8-proxy" })

      Write-Host ("picked=" + $id + " sources=" + $sources.Count + " direct=" + $direct.Count)
      if ($direct.Count -gt 0) {
        Write-Host ("firstDirect=" + [string]$direct[0].url)
        $passed = $true
        break
      }
    } catch {
      continue
    }
  }

  if (-not $passed) {
    Write-Host "No working direct stream found in first 8 items"
  }
}

# Deploy varianta web pe Cloudflare Pages (trucksos.net).
#
# Wrangler REFUZĂ să urce orice folder numit "node_modules" (listă hardcodată,
# cloudflare/workers-sdk#3615, închis "not planned"), iar Expo pune fonturile
# de iconițe sub dist/assets/node_modules/... — de aceea, după export:
#   1. redenumim dist/assets/node_modules -> dist/assets/nm
#   2. rescriem calea "assets/node_modules/" -> "assets/nm/" în bundle-ul JS
#   3. abia apoi facem wrangler pages deploy
#
# Rulare din rădăcina proiectului:  powershell -File scripts\deploy-web.ps1

$ErrorActionPreference = 'Stop'

npx expo export --platform web
if ($LASTEXITCODE -ne 0) { throw "expo export a eșuat" }

$nmDir = "dist/assets/node_modules"
$nmNew = "dist/assets/nm"
if (Test-Path $nmDir) {
    if (Test-Path $nmNew) { Remove-Item -Recurse -Force $nmNew }
    Rename-Item $nmDir "nm"
}

Get-ChildItem "dist/_expo/static/js/web" -Filter *.js | ForEach-Object {
    $text = [IO.File]::ReadAllText($_.FullName)
    $patched = $text.Replace('assets/node_modules/', 'assets/nm/')
    if ($patched -ne $text) {
        [IO.File]::WriteAllText($_.FullName, $patched)
        Write-Host "Cale asset rescrisă în $($_.Name)"
    }
}

npx wrangler pages deploy dist --project-name=trucksos --branch=main --commit-dirty=true
if ($LASTEXITCODE -ne 0) { throw "wrangler deploy a eșuat" }

Write-Host "Deploy OK -> https://trucksos.net"

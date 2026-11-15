#!/usr/bin/env bash
# Publishes the daily FIRMS files of every country to the live data store (Cloudflare R2, S3 API) and then
# points latest.json at them. Run by .github/workflows/update-data.yml after the data contract checks pass.
#
# Layout (see app/src/liveData.ts):
#   daily/<stamp>/<ISO3>/current.json          immutable, gzip-encoded, cached for a year
#   daily/<stamp>/<ISO3>/current_hotspots.csv  same
#   latest.json                                manifest, cached 5 min; written last, so readers never see a half run
#
# Needs: aws CLI, node; env R2_ACCOUNT_ID, R2_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY.
set -euo pipefail

: "${R2_ACCOUNT_ID:?}" "${R2_BUCKET:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"
export AWS_DEFAULT_REGION=auto
endpoint="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
data_dir="${1:-data/app}"
stamp="$(date -u +%Y-%m-%dT%H-%MZ)"
prefix="daily/${stamp}/"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

put() { # put <local file> <key> <content-type> <cache-control> [gzip]
  local src="$1" key="$2" type="$3" cache="$4" enc=()
  if [ "${5:-}" = gzip ]; then gzip -9 -n -c "$1" > "$tmp/upload"; src="$tmp/upload"; enc=(--content-encoding gzip); fi
  aws s3 cp "$src" "s3://${R2_BUCKET}/${key}" --endpoint-url "$endpoint" --only-show-errors \
    --content-type "$type" --cache-control "$cache" "${enc[@]}"
}

immutable="public, max-age=31536000, immutable"
countries=()
# iso3 and folder of every country in the site's index ("" = site root, for Paraguay)
while IFS=$'\t' read -r iso3 path; do
  dir="${data_dir}/${path}"
  if [ ! -f "${dir}current.json" ] || [ ! -f "${dir}current_hotspots.csv" ]; then
    echo "skip ${iso3}: no current files"; continue
  fi
  put "${dir}current.json" "${prefix}${iso3}/current.json" "application/json" "$immutable" gzip
  put "${dir}current_hotspots.csv" "${prefix}${iso3}/current_hotspots.csv" "text/csv; charset=utf-8" "$immutable" gzip
  countries+=("$iso3")
  echo "uploaded ${iso3} -> ${prefix}${iso3}/"
done < <(node -e '
  const idx = JSON.parse(require("fs").readFileSync(process.argv[1] + "/countries.json", "utf8"));
  for (const c of idx.countries) console.log(c.iso3 + "\t" + c.path);' "$data_dir")

if [ "${#countries[@]}" -eq 0 ]; then echo "nothing uploaded"; exit 1; fi

# every country's latest verdict in one small file, for the app's "South America now" row
node summary.mjs "$data_dir" "$tmp/summary.json"
put "$tmp/summary.json" "${prefix}summary.json" "application/json" "$immutable" gzip

node -e '
  const [prefix, ...isos] = process.argv.slice(1);
  const countries = Object.fromEntries(isos.map((i) => [i, i + "/"]));
  process.stdout.write(JSON.stringify({ generated: new Date().toISOString(), prefix, countries }) + "\n");' \
  "$prefix" "${countries[@]}" > "$tmp/latest.json"
put "$tmp/latest.json" "latest.json" "application/json" "public, max-age=300"
echo "latest.json -> ${prefix} (${countries[*]})"

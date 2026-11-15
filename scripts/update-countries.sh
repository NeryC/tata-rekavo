#!/usr/bin/env bash
# Daily update of every country in the site's index (data/app/countries.json): fetch the FIRMS Area API data, then check
# the data contract. A country that fails either step gets its previous files back, so the site keeps its last good data
# for that country, and the others still go out. The failed countries are listed in the file named by $1 (one per line)
# for the workflow's last step, which turns the run red so the failure is not missed.
#
# Adding a country needs no change here: it runs as soon as it is in the index.
# Needs: python (firms_pipeline.py), node; env FIRMS_MAP_KEY.
set -uo pipefail

failed_file="${1:-failed-countries.txt}"
data_dir="${2:-data/app}"
: > "$failed_file"

restore() { # put the committed files of a country back
  git checkout -- "$1/current.json" "$1/current_hotspots.csv" 2>/dev/null || true
}

while IFS=$'\t' read -r iso3 path; do
  dir="${data_dir}/${path}"; dir="${dir%/}"
  echo "::group::${iso3}"
  if ! python firms_pipeline.py fetch-current --country "$iso3" --out "$dir"; then
    echo "::warning::${iso3}: FIRMS fetch failed, keeping the previous data"
    echo "${iso3} (fetch)" >> "$failed_file"; restore "$dir"
  elif ! node test_contract.mjs "$dir"; then
    echo "::warning::${iso3}: data contract failed, keeping the previous data"
    echo "${iso3} (contract)" >> "$failed_file"; restore "$dir"
  fi
  echo "::endgroup::"
done < <(node -e '
  const idx = JSON.parse(require("fs").readFileSync(process.argv[1] + "/countries.json", "utf8"));
  for (const c of idx.countries) console.log(c.iso3 + "\t" + c.path);' "$data_dir")

echo "failed countries: $(wc -l < "$failed_file")"
exit 0

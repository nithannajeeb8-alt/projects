#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/wasm/pocketwise-engine.wasm"
mkdir -p "$ROOT/wasm"

if command -v em++ >/dev/null 2>&1; then
  echo "Building PocketWise engine with Emscripten"
  em++ "$ROOT/engine/financial_engine.cpp" \
    -std=c++17 -O3 -fno-exceptions -fno-rtti -nostdlib \
    -sSTANDALONE_WASM=1 -sALLOW_MEMORY_GROWTH=1 \
    -Wl,--no-entry \
    -Wl,--export=pw_alloc -Wl,--export=pw_reset -Wl,--export=pw_aggregate \
    -Wl,--export=pw_equal_split -Wl,--export=pw_percentage_split -Wl,--export=pw_amount_split \
    -Wl,--export=pw_sum_minor -Wl,--export=pw_cash_delta_minor -Wl,--export=pw_account_balance -Wl,--export=pw_debt_remaining \
    -Wl,--export=pw_salary_allocate -Wl,--export=pw_category_buckets -Wl,--export=pw_cash_projection -Wl,--export=pw_ratio_round_minor \
    -Wl,--export-memory \
    -Wl,--initial-memory=2097152 -Wl,--max-memory=268435456 \
    -o "$OUT"
elif command -v clang++ >/dev/null 2>&1; then
  echo "Emscripten (em++) was not found; building the same freestanding WASM ABI with clang++ instead."
  clang++ --target=wasm32-unknown-unknown "$ROOT/engine/financial_engine.cpp" \
    -std=c++17 -O3 -nostdlib -fno-exceptions -fno-rtti \
    -Wl,--no-entry \
    -Wl,--export=pw_alloc -Wl,--export=pw_reset -Wl,--export=pw_aggregate \
    -Wl,--export=pw_equal_split -Wl,--export=pw_percentage_split -Wl,--export=pw_amount_split \
    -Wl,--export=pw_sum_minor -Wl,--export=pw_cash_delta_minor -Wl,--export=pw_account_balance -Wl,--export=pw_debt_remaining \
    -Wl,--export=pw_salary_allocate -Wl,--export=pw_category_buckets -Wl,--export=pw_cash_projection -Wl,--export=pw_ratio_round_minor \
    -Wl,--export-memory \
    -Wl,--initial-memory=2097152 -Wl,--max-memory=268435456 \
    -Wl,--strip-all -o "$OUT"
else
  echo "Neither em++ nor a wasm-capable clang++ was found." >&2
  exit 1
fi

node - "$OUT" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const bytes = fs.readFileSync(file);
if (!WebAssembly.validate(bytes)) throw new Error('Generated WASM module did not validate');
WebAssembly.instantiate(bytes, {}).then(({ instance }) => {
  for (const name of ['memory', 'pw_alloc', 'pw_reset', 'pw_aggregate', 'pw_equal_split', 'pw_percentage_split', 'pw_amount_split', 'pw_sum_minor', 'pw_cash_delta_minor', 'pw_account_balance', 'pw_debt_remaining', 'pw_salary_allocate', 'pw_category_buckets', 'pw_cash_projection', 'pw_ratio_round_minor']) {
    if (!(name in instance.exports)) throw new Error(`Missing WASM export: ${name}`);
  }
  process.stdout.write(`Validated ${file} (${bytes.length} bytes)\n`);
}).catch(error => { console.error(error); process.exit(1); });
NODE

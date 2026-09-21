#!/bin/sh
set -eu

mascot_script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
mascot_skill_dir=$(dirname "$mascot_script_dir")
mascot_repo_root=$(git -C "$mascot_skill_dir" rev-parse --show-toplevel)
mascot_template_dir="$mascot_skill_dir/assets/mascot-preview"
mascot_preview_dir="$mascot_repo_root/.codex-mascot-preview"

mkdir -p "$mascot_preview_dir"
cp "$mascot_template_dir/index.html" "$mascot_preview_dir/index.html"
cp "$mascot_template_dir/main.tsx" "$mascot_preview_dir/main.tsx"
cp "$mascot_template_dir/preview.css" "$mascot_preview_dir/preview.css"

echo "吉祥物预览已生成：$mascot_preview_dir"

if [ "${1:-}" = "--prepare-only" ]; then
  exit 0
fi

if [ ! -x "$mascot_repo_root/node_modules/.bin/vite" ]; then
  echo "未找到 Vite，请先在客户端仓库安装依赖。" >&2
  exit 1
fi

cd "$mascot_repo_root"
exec "$mascot_repo_root/node_modules/.bin/vite" "$mascot_preview_dir" --host 127.0.0.1 --port "${MASCOT_PREVIEW_PORT:-4178}"

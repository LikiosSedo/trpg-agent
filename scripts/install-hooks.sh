#!/usr/bin/env bash
# 安装 trpg-agent 的 git hooks（pre-commit 资源校验提醒）
#
# 用法: ./scripts/install-hooks.sh
# 卸载: rm .git/hooks/pre-commit
#
# 为什么不放在 npm postinstall 里自动跑？
#   - 自动改 .git/ 算"侵入性副作用"，不希望普通 npm install 静默改 git 配置
#   - maintainer 第一次明确跑一次就够了，clone 下来手动安装

set -e

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

if [ ! -d .git ]; then
  echo "✗ 不在 git 仓库根目录"
  exit 1
fi

mkdir -p .git/hooks
chmod +x scripts/git-hooks/pre-commit

# 用相对符号链接，便于 hook 跟随仓库源码更新
ln -sf "../../scripts/git-hooks/pre-commit" .git/hooks/pre-commit

echo "✓ pre-commit hook 已安装"
echo "  source: scripts/git-hooks/pre-commit"
echo "  symlink: .git/hooks/pre-commit"
echo ""
echo "测试: 改一个 mp3 (例如 touch public/audio/town-day.mp3)"
echo "      然后 git commit, 应该看到 pre-commit 提示"
echo ""
echo "卸载: rm .git/hooks/pre-commit"
echo "跳过单次 commit: git commit --no-verify"
echo "跳过所有 commit: SKIP_ASSET_HOOK=1 git commit ..."

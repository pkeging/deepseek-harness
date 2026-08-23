#!/bin/bash
# Agnes 2.0 Flash 启动脚本
# 使用方式：
#   ./start-agnes.sh              # 使用环境变量
#   ./start-agnes.sh file         # 使用凭证文件

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 API Key
if [ -z "$AGNES_API_KEY" ] && [ ! -f ".credentials.yaml" ]; then
  echo "错误：未找到 AGNES_API_KEY 环境变量或 .credentials.yaml 文件"
  echo ""
  echo "请执行以下任一操作："
  echo "  1. 设置环境变量: export AGNES_API_KEY='sk-xxx'"
  echo "  2. 创建凭证文件: cp .credentials.yaml.example .credentials.yaml"
  echo "     然后编辑 .credentials.yaml 填入真实密钥"
  exit 1
fi

# 设置 DSH_HOME（默认使用项目根目录下的 .dsh-agnes）
export DSH_HOME="${DSH_HOME:-$(dirname "$SCRIPT_DIR")/.dsh-agnes}"
mkdir -p "$DSH_HOME"

echo "启动 Agnes 2.0 Flash 配置..."
echo "DSH_HOME: $DSH_HOME"
echo ""

# 启动 dsh
exec dsh web --cordis examples/agnes-demo/cordis.yml "$@"

#!/usr/bin/env sh
# 为移动端 dshgo(proot) 宿主补运行时依赖软链。
#
# 背景：插件自身的静态 import 用到宿主提供的三个包
#   @deepseek-ai/dsh-llm  @deepseek-ai/dsh-home-paths  @deepseek-ai/schemastery
# 桌面宿主的 node_modules 就在 dsh 安装目录旁，ESM 能向上找到；
# 手机 App 里引擎跑在 proot，这些包在 /opt/dsh/node_modules，
# 而插件目录 /root/.dsh/plugins/<name> 的向上查找链够不到，
# 于是启动报 ERR_MODULE_NOT_FOUND，插件不激活（1 entry did not activate）。
#
# 用法（在手机 proot 的 bash 里）：
#   sh /root/.dsh/plugins/dsh-auto-router-dshgo/scripts/link-host-deps.sh
# 之后在 App 里停引擎→起引擎（或重开 App）生效。
#
# 幂等：重复执行只刷新软链；宿主缺哪个包就跳过哪个，不报错。

set -eu

HOST_NODE_MODULES="${DSH_HOST_NODE_MODULES:-/opt/dsh/node_modules}"
PACKAGES="dsh-llm dsh-home-paths schemastery"

PLUGIN_DIR=$(cd "$(dirname "$0")/.." && pwd)
TARGET_DIR="$PLUGIN_DIR/node_modules/@deepseek-ai"

echo "plugin: $PLUGIN_DIR"
echo "host:   $HOST_NODE_MODULES"
mkdir -p "$TARGET_DIR"

linked=0
skipped=0
for name in $PACKAGES; do
  src="$HOST_NODE_MODULES/@deepseek-ai/$name"
  dst="$TARGET_DIR/$name"
  if [ ! -d "$src" ]; then
    echo "skip   $name（宿主没有 $src）"
    skipped=$((skipped + 1))
    continue
  fi
  ln -sfn "$src" "$dst"
  echo "link   $name -> $src"
  linked=$((linked + 1))
done

echo "完成：$linked 条已链，$skipped 条跳过。"
echo "下一步：重启 dsh 引擎；启动日志不再出现 'entry did not activate'，模型列表出现 智能路由 Auto Router。"

#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${TODOLIST_REPO_URL:-https://github.com/user/todolist.git}"
INSTALL_METHOD=""
UV_BIN=""

info()  { printf "\033[1;34m[info]\033[0m  %s\n" "$*"; }
warn()  { printf "\033[1;33m[warn]\033[0m  %s\n" "$*"; }
error() { printf "\033[1;31m[error]\033[0m %s\n" "$*" >&2; }

check_python() {
    for cmd in python3.12 python3.13 python3; do
        if command -v "$cmd" &>/dev/null; then
            ver=$("$cmd" -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
            major=$(echo "$ver" | cut -d. -f1)
            minor=$(echo "$ver" | cut -d. -f2)
            if [ "$major" -ge 3 ] && [ "$minor" -ge 12 ]; then
                PYTHON_BIN="$cmd"
                return 0
            fi
        fi
    done
    return 1
}

install_uv() {
    info "正在安装 uv..."
    if command -v curl &>/dev/null; then
        curl -LsSf https://astral.sh/uv/install.sh | sh
    elif command -v wget &>/dev/null; then
        wget -qO- https://astral.sh/uv/install.sh | sh
    else
        error "需要 curl 或 wget 来安装 uv"
        exit 1
    fi
    # shellcheck source=/dev/null
    export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
    if ! command -v uv &>/dev/null; then
        error "uv 安装失败，请手动安装: https://docs.astral.sh/uv/"
        exit 1
    fi
    info "uv 安装成功"
}

find_uv() {
    if command -v uv &>/dev/null; then
        UV_BIN="uv"
        return 0
    fi
    # uv might be installed but not in PATH yet
    for p in "$HOME/.local/bin/uv" "$HOME/.cargo/bin/uv"; do
        if [ -x "$p" ]; then
            UV_BIN="$p"
            export PATH="$(dirname "$p"):$PATH"
            return 0
        fi
    done
    return 1
}

install_from_git() {
    local tmpdir
    tmpdir=$(mktemp -d)
    trap "rm -rf '$tmpdir'" EXIT

    info "正在克隆仓库..."
    git clone --depth 1 "$REPO_URL" "$tmpdir/todolist" 2>/dev/null || {
        error "无法克隆仓库: $REPO_URL"
        error "请设置 TODOLIST_REPO_URL 环境变量指向仓库地址"
        exit 1
    }

    info "正在安装 todo CLI..."
    $UV_BIN tool install --from "$tmpdir/todolist/server" todolist-server 2>/dev/null || \
    $UV_BIN tool install "$tmpdir/todolist/server" 2>/dev/null || {
        error "安装失败"
        exit 1
    }
}

install_from_local() {
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local server_dir="$script_dir/../server"

    if [ ! -f "$server_dir/pyproject.toml" ]; then
        error "未找到 server/pyproject.toml，请在项目根目录运行此脚本"
        exit 1
    fi

    info "正在安装 todo CLI..."
    $UV_BIN tool install --from "$server_dir" todolist-server 2>/dev/null || \
    $UV_BIN tool install "$server_dir" 2>/dev/null || {
        error "安装失败"
        exit 1
    }
}

verify_install() {
    if command -v todo &>/dev/null; then
        local version
        version=$(todo --version 2>/dev/null || echo "unknown")
        info "安装成功！版本: $version"
        info ""
        info "快速开始:"
        info "  todo health              # 检查 API 连接"
        info "  todo --help              # 查看帮助"
        info "  todo task ls             # 列出任务"
        info ""
        info "卸载: uv tool uninstall todolist-server"
    else
        warn "todo 命令未在 PATH 中找到"
        warn "可能需要重启终端或执行: source ~/.bashrc"
        warn ""
        warn "也可以手动添加 PATH:"
        warn "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
}

main() {
    echo ""
    echo "  ╔══════════════════════════════════════╗"
    echo "  ║     AI 清单 CLI 安装程序             ║"
    echo "  ╚══════════════════════════════════════╝"
    echo ""

    # 1. Check Python
    if check_python; then
        info "检测到 Python: $PYTHON_BIN"
    else
        error "需要 Python 3.12 或更高版本"
        error "请先安装 Python: https://www.python.org/downloads/"
        exit 1
    fi

    # 2. Check/install uv
    if find_uv; then
        info "检测到 uv: $($UV_BIN --version)"
    else
        install_uv
    fi

    # 3. Install
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [ -f "$script_dir/../server/pyproject.toml" ]; then
        install_from_local
    else
        install_from_git
    fi

    # 4. Verify
    verify_install
}

main "$@"

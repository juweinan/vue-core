# .node-version 使用指南与实现原理

## 1. 什么是 .node-version

`.node-version` 是一个纯文本文件，放在项目根目录中，用于声明该项目所需的 Node.js 版本。文件内容只包含一个版本号，例如：

```
18.20.8
```

它被 fnm、nvm、volta 等 Node.js 版本管理器识别，实现**进入项目目录时自动切换 Node.js 版本**。

---

## 2. 使用方式

### 2.1 前提条件

需要安装以下任意一个 Node.js 版本管理器：

| 工具 | 安装方式 | 是否内置支持 .node-version |
|------|----------|--------------------------|
| fnm  | `brew install fnm` | 是 |
| nvm  | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh \| bash` | 通过 `.nvmrc` 支持 |
| volta | `curl https://get.volta.sh \| bash` | 通过 `package.json` 的 `volta` 字段 |

本文以 fnm 为例。

### 2.2 配置 fnm 自动切换

安装 fnm 后，在 shell 配置文件中添加以下内容：

**Zsh（macOS 默认）** - 编辑 `~/.zshrc`：

```bash
eval "$(fnm env --use-on-cd)"
```

**Bash** - 编辑 `~/.bashrc`：

```bash
eval "$(fnm env --use-on-cd)"
```

配置后重新加载：

```bash
source ~/.zshrc  # 或 source ~/.bashrc
```

### 2.3 创建 .node-version 文件

在项目根目录下创建：

```bash
cd /path/to/your-project
echo "18.20.8" > .node-version
```

### 2.4 安装对应的 Node.js 版本

```bash
fnm install 18.20.8
```

### 2.5 验证自动切换

```bash
cd ~
node -v              # 显示默认版本，如 v24.13.0

cd /path/to/project
node -v              # 自动切换到 v18.20.8
```

### 2.6 版本号写法

`.node-version` 文件支持多种写法：

```
18.20.8      # 精确版本（推荐）
18           # 主版本号，使用该大版本下已安装的最新版
20.19.0      # 精确版本
```

---

## 3. 实现原理

### 3.1 核心机制：Shell Hook

fnm 的自动切换依赖 shell 的**目录切换钩子**（hook）。当执行 `eval "$(fnm env --use-on-cd)"` 时，fnm 做了以下事情：

```
1. 设置环境变量（FNM_DIR、FNM_MULTISHELL_PATH 等）
2. 将 fnm 管理的 Node.js 路径插入 PATH
3. 注册 shell 钩子函数，监听目录变化
```

以 Zsh 为例，fnm 注册了 `chpwd` 钩子：

```
用户执行 cd 命令
    ↓
Zsh 触发 chpwd 钩子
    ↓
fnm 钩子函数执行
    ↓
从当前目录向上查找 .node-version 文件
    ↓
找到 → 读取版本号 → 切换 PATH 中的 Node.js 路径
未找到 → 使用默认版本
```

### 3.2 版本查找规则

fnm 使用**就近原则**，从当前目录逐级向上查找：

```
/Users/you/code/project/src/components/
    ↓ 查找 .node-version（无）
/Users/you/code/project/src/
    ↓ 查找 .node-version（无）
/Users/you/code/project/
    ↓ 查找 .node-version（找到！使用该版本）
```

这意味着子目录可以覆盖父目录的版本配置：

```
project/
├── .node-version          # 18.20.8
├── packages/
│   └── sub-project/
│       └── .node-version  # 20.19.0（优先级更高）
```

### 3.3 PATH 替换原理

fnm 并不是每次都重新安装 Node.js，而是通过修改 `PATH` 环境变量来实现版本切换：

```
切换前 PATH:
  /Users/you/.fnm/node-versions/v24.13.0/installation/bin:...

切换后 PATH:
  /Users/you/.fnm/node-versions/v18.20.8/installation/bin:...
```

每个 Node.js 版本独立存储在 `~/.fnm/node-versions/` 目录下，切换版本的本质是**替换 PATH 中的路径指向**，因此切换速度非常快（毫秒级）。

### 3.4 存储结构

```
~/.fnm/
├── aliases/
│   └── default/             # 默认版本的符号链接
├── node-versions/
│   ├── v18.20.8/
│   │   └── installation/
│   │       ├── bin/
│   │       │   ├── node
│   │       │   ├── npm
│   │       │   └── npx
│   │       └── ...
│   ├── v20.20.0/
│   │   └── installation/
│   └── v24.13.0/
│       └── installation/
```

---

## 4. 与其他配置文件的关系

不同工具使用不同的配置文件：

| 文件 | 支持工具 | 说明 |
|------|---------|------|
| `.node-version` | fnm、nvm、nodenv | 通用性最好 |
| `.nvmrc` | nvm、fnm | nvm 原生格式，fnm 也支持 |
| `package.json` 的 `engines` 字段 | npm、yarn | 安装依赖时校验，不自动切换 |
| `package.json` 的 `volta` 字段 | volta | volta 专用 |

**建议**：优先使用 `.node-version`，兼容性最广。

---

## 5. Shell 基础命令说明

本文档中出现了一些 Shell 命令，如果你对它们不熟悉，可以参考以下说明。

### 5.1 `echo` - 输出文本

`echo` 的作用是将文本输出到终端或写入文件：

```bash
echo "Hello"                    # 在终端显示：Hello
echo "18.20.8" > .node-version  # 将文本写入文件（覆盖）
echo "new line" >> file.txt     # 将文本追加到文件末尾
```

- `>` 覆盖写入：文件原有内容会被清空
- `>>` 追加写入：在文件末尾添加内容

### 5.2 `source` - 重新加载配置

`source` 的作用是在**当前 shell 环境**中执行脚本文件，使修改立即生效：

```bash
source ~/.zshrc  # 重新加载 zsh 配置，修改立即生效
. ~/.zshrc       # 简写形式，效果完全相同
```

**为什么需要 source？**

修改 `~/.zshrc` 后，配置不会自动生效。你有两个选择：
1. 关闭终端重新打开（配置会在启动时加载）
2. 执行 `source ~/.zshrc`（立即生效，不用重启终端）

### 5.3 `eval` - 执行动态生成的命令

`eval` 的作用是将一段文本当作命令来执行：

```bash
eval "$(fnm env --use-on-cd)"
```

这行命令的执行过程分三步：

```
第 1 步：fnm env --use-on-cd
  → fnm 输出一段 shell 代码（设置环境变量、注册钩子等）

第 2 步：$(...) 语法
  → 捕获上一步输出的文本

第 3 步：eval "..."
  → 将捕获到的文本当作命令执行
```

类比 JavaScript：就像 `eval("console.log('hello')")` 一样，将字符串当代码执行。

### 5.4 `export` - 设置环境变量

`export` 用于设置环境变量，使其对当前 shell 及其子进程可用：

```bash
export PATH="/usr/local/bin:$PATH"   # 将路径添加到 PATH
export MY_VAR="hello"                # 设置自定义变量
echo $MY_VAR                         # 读取变量：hello
```

### 5.5 `~` 符号 - 用户主目录

`~` 是当前用户主目录的简写：

```bash
~              # 等同于 /Users/你的用户名
~/.zshrc       # 等同于 /Users/你的用户名/.zshrc
```

### 5.6 如何编辑 `~/.zshrc` 文件

`~/.zshrc` 是 Zsh 的配置文件，每次打开终端时会自动执行其中的内容。

**编辑方式：**

```bash
# 方式 1：用 VSCode 打开（推荐，需要安装 code 命令）
code ~/.zshrc

# 方式 2：用 nano 在终端中编辑（系统自带）
nano ~/.zshrc
# Ctrl + O 保存，Ctrl + X 退出

# 方式 3：用 macOS 自带文本编辑器打开
open -e ~/.zshrc
```

> **提示**：如果 `code` 命令不存在，在 VSCode 中按 `Cmd + Shift + P`，
> 输入 `shell command`，选择 **Install 'code' command in PATH** 即可安装。

### 5.7 Shell 学习资源

如果你想系统学习 Shell，以下资源推荐参考：

- **在线练习**：https://www.learnshell.org/（支持中文，边学边练）
- **命令解释**：https://explainshell.com/（输入命令自动解释每个部分）
- **快速查询**：终端安装 `brew install tldr`，然后用 `tldr echo` 查看常用示例
- **书籍**：《快乐的 Linux 命令行》（免费中文版：http://billie66.github.io/TLCL/book/）

---

## 6. 常用命令速查

```bash
fnm list                # 查看已安装版本
fnm list-remote         # 查看可安装版本
fnm install 20          # 安装指定版本
fnm use 20              # 手动切换版本
fnm default 24          # 设置默认版本
fnm current             # 查看当前版本
fnm uninstall 16        # 卸载指定版本
```

---

## 7. 注意事项

1. **全局 npm 包不共享**：每个 Node.js 版本有独立的全局包目录，切换版本后全局安装的 CLI 工具（如 pnpm）需要在对应版本下重新安装。

2. **VSCode 终端**：打开项目后新建的终端会自动读取 `.node-version` 并切换版本。如果未生效，尝试重启终端。

3. **CI/CD 环境**：GitHub Actions 等 CI 工具原生支持 `.node-version` 文件，无需额外配置：

   ```yaml
   # GitHub Actions 示例
   - uses: actions/setup-node@v4
     with:
       node-version-file: '.node-version'
   ```

4. **团队协作**：建议将 `.node-version` 提交到 Git，确保团队成员使用相同的 Node.js 版本。

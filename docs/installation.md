# 安装与使用 · v1.0.0

**推荐先使用便携运行包。完整工程包适合继续修改素材、模型和程序。**

## 选择下载包

前往 [GitHub Releases](https://github.com/ycwycw2020/GPT_Dragon_girl_transformation/releases)，选择对应文件：

| 文件 | 适合谁 |
| --- | --- |
| `GPT_Dragon_girl_transformation-v1.0.0.zip` | 直接运行桌宠，已包含 Electron、渲染组件、模型和贴图 |
| `GPT_Dragon_girl_transformation-project-v1.0.0.zip` | 修改源码或美术，包含运行组件、测试、构建文件、角色原图、分层素材和 Cubism 工程 |
| `SHA256SUMS.txt` | 校验两个压缩包是否与发布文件一致 |

GitHub **Code → Download ZIP** 下载的是仓库源码，不保证包含完整运行依赖或大型制作素材。当前版本为无配音版，不需要配置音频生成服务或 API 密钥。

## 启动便携版

1. 使用 **Windows x64**，将整个压缩包解压到可写目录，例如 `D:\Apps\GPT_Dragon_girl_transformation`。
2. 双击包根目录的 **`start.cmd`**。
3. 初次出现时默认大小为 **180 × 200 逻辑像素**。角色不占任务栏按钮，在系统托盘保留图标。
4. 右键角色或托盘，调整缩放、监听任务与显示选项。

基本显示、拖动和互动不要求另装 Node.js、Python、npm 或 Cubism Editor。不要直接从压缩软件中启动，也不要只复制其中的 EXE；`outputs/` 内部路径需要保持完整。

完整工程中的运行入口同样是：

```text
outputs/dragon-companion-app-v4/start.cmd
```

首次运行不会带入制作电脑的好感度、聊天状态或信任配置。尚未连接 Codex 时仍可使用桌宠，任务状态和额度保持未知。

### 点击任务思考泡

轻点电脑上方的思考泡，先播放约 **0.56 秒**的云片破碎，再返回被点击提示对应的 Codex 聊天；拖动只移动桌宠。从点击起约 **6.5 秒**后，如果仍监听同一任务、任务还在运行且状态有效，气泡重新出现；已结束或状态失效则保持收起。

切换监听任务，或右键选择 **显示任务气泡**，可立即恢复。跳转失败会还原提示；任务结束后的小 `×` 只收起云朵，不跳转。开启系统“减少动态效果”时破碎动画会缩短。独立的粉白提问提醒仍是直接点击跳转。

## 校验压缩包

在下载目录打开 PowerShell，分别运行：

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath '.\GPT_Dragon_girl_transformation-v1.0.0.zip'
Get-FileHash -Algorithm SHA256 -LiteralPath '.\GPT_Dragon_girl_transformation-project-v1.0.0.zip'
```

将结果与 `SHA256SUMS.txt` 中对应文件的摘要比较。只校验你实际下载的包即可。

## 从旧版本升级

1. 在桌宠托盘菜单选择 **退出**。
2. 将新版完整解压到新目录，保留旧目录中的个人数据备份。
3. 如需延续成长与窗口偏好，在新版首次启动前复制以下文件到相同相对位置；目标文件夹可手动建立：

   - `work/desktop-app-v4/life-state.json`：好感、经验、问候与休息状态。
   - `work/desktop-app-v4/window-settings.json`：位置、缩放、气泡显示与固定监听选择。

4. 启动新版，确认模型、互动和监听正常。
5. 安装位置变更后，更新旧 Hooks 的脚本路径和随启动快捷方式；新版安装包不会自动搬迁系统配置。

不要把旧版完整 `work/` 覆盖到新版，不需要迁移聊天缓存、测试报告、旧语音设置或配音文件。v1.0.0 没有配音功能。

## Codex 接入与排查

### 全局任务发现

桌宠默认只读当前用户的 `.codex` 用户数据目录。任务来源包括本地聊天索引、轮次生命周期，以及会话记录中的有界事件检查，**不按项目所在目录限制发现范围**。

打开 Codex 后，右键 → **切换监听任务**。菜单最多显示最近 **200 个未归档主聊天**，优先使用聊天名称；同目录的不同会话分别列出。选择 **自动跟随任务**，或固定某个聊天。已经结束的固定聊天不会自动切换到别处。

若使用自定义 Codex 数据目录，桌宠应继承相同的 `CODEX_HOME`。例如在便携包根目录的 PowerShell 中启动：

```powershell
$env:CODEX_HOME = 'D:\CodexData'
.\start.cmd
```

此设置仅适用于当前 PowerShell 及其启动的程序。它必须指向你的实际 Codex 数据目录，而不是随意建立的空目录；不同账户、不同 `CODEX_HOME` 与远端未同步数据不属于同一监听范围。

找不到聊天时，依次检查：

1. Codex 与桌宠是否使用同一 Windows 用户和数据目录。
2. 聊天是否归档、是否已经写入本机数据，以及是否在最近 200 条范围内。
3. 托盘菜单上方是否显示 **Codex全局任务已接入**。
4. 完整退出并重新启动桌宠后，状态是否恢复。

本地数据库不可访问或结构变化时，程序会降级使用现有 Hooks；仍无法确认的任务显示未知。它不会仅凭目录、日志时间或额度变动宣称任务正在运行。

### 提问提醒与 Hooks

全局任务发现不要求先安装 Hooks；**提问提示和部分更细的操作事件**需要对应 Hooks 正常运行并获得信任。

准备脚本需要 **Node.js 24 或更高版本**。Windows 下，其可执行文件路径不能含空格或 shell 特殊字符；脚本不满足要求时会明确中止。在项目或便携包根目录运行：

```powershell
# 生成与当前安装位置对应的定义；此步骤不会安装或信任
node .\outputs\dragon-codex-bridge-v4\prepare-hooks.mjs

# 预览安装计划
node .\outputs\dragon-codex-bridge-v4\install-hooks.mjs

# 确认路径正确后，合并到用户级配置
node .\outputs\dragon-codex-bridge-v4\install-hooks.mjs --apply
```

安装器会备份原配置并保留其他 Hooks。完成后，在 Codex 提供的 Hooks 审核入口检查并信任指向本项目 `hook.mjs` 的条目；使用支持该命令的 CLI 时可进入 `/hooks`。安装脚本不会自动授予信任。

“我有新的提问(｡･∀･)ﾉﾞ”识别支持的提问工具事件，不把普通聊天问句当成弹窗，也不保证捕获所有权限请求。提醒可点击返回对应聊天，回答与审核仍在 Codex 中完成。

### 额度

额度单独依赖可被程序找到、且已登录的 **完整 Codex CLI**，通过只读账户接口读取。基础任务发现成功并不代表额度已连接；无法读取时显示未知。

如果终端提示找不到 `codex`，先检查 CLI 是否正确安装以及 PATH 是否更新。Codex 桌面应用附带的内部可执行文件不一定是完整的独立 CLI 包。不要把额度未知当作额度已经耗尽。

## 可选：随 Codex 启动

项目提供 `codex-follower.js` 后台观察器。当前适配 **Windows 商店版 Codex 桌面应用**：每 3 秒检查进程名称、路径与父进程，在发现桌面主进程启动后打开桌宠。

观察器不读取聊天、不修改 Codex，不重复打开已运行的桌宠。手动退出桌宠后，在该次 Codex 运行期间不会立即把她重新打开；只有关闭所有主进程后重新启动才算新的启动。

需要启用时，在安装目录根部打开 PowerShell，运行下面的脚本创建当前用户的启动快捷方式：

```powershell
$petProjectRoot = (Get-Location).Path
$petFollowerFile = Join-Path $petProjectRoot 'outputs\dragon-companion-app-v4\codex-follower.js'
if (-not (Test-Path -LiteralPath $petFollowerFile)) { throw '请先进入完整安装目录。' }
$petStartupDir = [Environment]::GetFolderPath('Startup')
$petShortcutFile = Join-Path $petStartupDir 'GPT_Dragon_girl_transformation - 跟随 Codex.lnk'
$petShortcut = (New-Object -ComObject WScript.Shell).CreateShortcut($petShortcutFile)
$petShortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$petShortcut.Arguments = '"' + $petFollowerFile + '"'
$petShortcut.WorkingDirectory = $petProjectRoot
$petShortcut.WindowStyle = 7
$petShortcut.Save()
```

下次 Windows 登录时观察器自动运行；想立即使用，可在用户“启动”文件夹双击该快捷方式。自定义 `CODEX_HOME` 应让观察器和 Codex 继承一致的环境；仅在某个临时终端中设置变量不会自动影响以后登录启动的观察器。

取消随启动：删除上述快捷方式。若要让当前观察器也退出，可在安装目录的 `work/desktop-app-v4/` 中创建空文件 **`follow-disabled.flag`**；恢复前删除标志并重新启动快捷方式。移动安装目录后需要重建快捷方式。

## 日常维护

- 数据默认保存在安装目录的 `work/desktop-app-v4/` 和 `work/codex-bridge-v4/`，请使用可写目录。
- 原图、分层素材与 `.cmo3` 是制作素材；运行使用导出的 `.moc3` 和程序动画，不需要常驻 Cubism Editor。
- 鼠标穿透导致无法操作时，双击托盘图标，或按 `Ctrl` + `Alt` + `Shift` + `D` 恢复交互。
- **休息只能让桌宠休息，不能停止 Codex 的项目。** 停止操作请回到 Codex。
- 发布或分享源码时，不要附带个人 `work/`、聊天记录、密钥、Hooks 信任数据或机器专用配置。

[返回项目首页](../README.md) · [互动说明](touch-guide.md) · [窗口与气泡](window-presentation.md)

<div align="center">

# GPT娘 · Live2D 桌面工作伴侣

**白发紫瞳的小龙娘，在桌边陪你认真工作。**

Windows x64 · 透明桌宠 · Codex 状态联动 · 本地养成

<img src="docs/images/gpt-niang.png" width="420" alt="白发紫瞳、佩戴结形头饰的Q版龙娘坐在电脑桌前">

**「我有新的提问(｡･∀･)ﾉﾞ」**

[快速开始](#快速开始) · [操作指南](#操作指南) · [Codex 接入](#codex-接入) · [完成情况](#完成情况) · [常见问题](#常见问题)

</div>

---

## 关于 GPT娘

GPT娘是一款在本地运行的 Live2D 桌面伴侣。她会在电脑桌前轻轻呼吸、摇晃尾巴和呆毛，工作时移动鼠标、敲击键盘，也会在 Codex 发来问题时，用粉白色的小气泡提醒你。

角色固定为**银白偏淡紫长发、紫瞳、白色节纹龙角、尖耳的 Q 版龙娘**，保留 ChatGPT 结形头饰。白紫服装、流苏、结饰和桌上的杯子、笔记本与小摆件，共同组成她的小小工作角落。

本项目是独立制作的个人桌宠项目，并非 OpenAI 或 Live2D 官方产品。

## 功能一览

| 功能 | 当前支持 |
| --- | --- |
| 真实 Live2D | 加载 Cubism 导出的 `.moc3`，已完成首个工作模型 |
| 工作动作 | 呼吸、呆毛、尾巴、握鼠手与鼠标联动、食指敲击键盘 |
| 透明桌面窗口 | 置顶、自由拖动、缩放、可选鼠标穿透、位置记忆 |
| 任务卡片 | 当前目录、操作类型、额度、好感度、等级与经验 |
| 多会话跟随 | 自动跟随活跃会话，或下拉固定会话 |
| 提问气泡 | 捕获到支持的提问事件时，在桌宠上方显示粉白提醒 |
| 新建聊天 | 从卡片打开当前目录下的 Codex 新聊天输入界面 |
| 陪伴与成长 | 点击反馈、早午晚问候、好感、经验、等级、临时陪玩与休息模式 |
| 本地保存 | 设置和养成数据保存在本项目的 `work/` 中 |

### 粉白提问气泡

<div align="center">
<img src="docs/images/question-notice.png" width="278" alt="粉白色圆润提示框：我有新的提问(｡･∀･)ﾉﾞ">
</div>

圆润的幼圆字体、奶白与樱粉渐变、爱心和小星光，让提醒尽量轻巧。没有幼圆字体时会使用系统后备字体；无需下载字体。

- 主句固定为 **“我有新的提问(｡･∀･)ﾉﾞ”**。
- 提示框位于角色上方，随拖动和缩放重新定位；贴近屏幕边缘时自动保持在屏幕内。
- 不抢走当前输入焦点；点击 `×` 可以关闭。同一条提醒关闭后不会反复弹出。
- 最长显示 5 分钟。新一轮用户输入、会话结束或对应的同步问题返回时，会清除相应提醒。
- 自动跟随时显示最近捕获的提问；固定会话时只提示该会话。
- 这是**收到提问的提醒**，不保证问题此刻仍未回答。问题内容、回复与权限确认都在 Codex 原界面处理。

当前版本保留简洁任务卡片，**没有回复草稿、复制转交、直接发送、追加要求输入框或自动批准功能**。

## 快速开始

### 运行便携版

当前版本：**v0.4.5**。已在 Windows x64 环境验证；其他平台暂未验证。

1. 获取对应版本的便携压缩包。若仓库已发布 Releases，请使用 Releases 中的运行包；GitHub 的 **Download ZIP** 源码包不等于可运行的便携包。
2. 将整个压缩包解压到可写目录，例如 `D:\tool\GPT娘`。
3. 双击包根目录的 **`start.cmd`**。
4. 她会以默认 **180 × 200 逻辑像素**出现，宽、高分别为最初 540 × 600 尺寸的 1/3。

便携包附带 Electron 与 Cubism Web 运行组件。基本运行无需另装 Node.js、Python、npm 或 Cubism Editor，也不要只复制其中的 EXE。

> 不要直接在压缩软件中运行。请完整保留 `outputs/` 内部结构，程序依靠相对路径加载模型和贴图。

首次解压不会带入制作电脑的好感度、聊天状态或 Hooks 信任记录。未连接 Codex 时，仍可显示、拖动、缩放和互动，任务或额度会显示未知。

### 从项目目录启动

已有完整项目及运行依赖时，双击：

```text
outputs/dragon-companion-app-v4/start.cmd
```

源码文件本身不保证包含大型 Electron 运行时与所有制作素材；缺少运行依赖时，请先使用经过验证的便携包。

## 操作指南

| 想做什么 | 操作 |
| --- | --- |
| 移动桌宠 | 按住角色、桌面主体或任务卡片文字区域拖动 |
| 调整大小 | 指针放在角色上，按住 `Ctrl` 滚动鼠标，或右键 → 缩放 |
| 键盘缩放 | 角色窗口获得焦点后，`Ctrl` + `+` / `-`；`Ctrl` + `0` 恢复默认 |
| 重置位置 | 角色或托盘右键 → 重置位置 |
| 固定跟随任务 | 使用任务卡片下拉框选择会话；悬停目录可查看完整路径 |
| 新建聊天 | 点击任务卡片“＋ 新建聊天”；只打开输入界面，不自动发送 |
| 收起任务卡片 | 点击卡片右上角 `−`；右键菜单可重新显示 |
| 关闭提问提醒 | 点击粉白提示框右上角 `×` |
| 查看好感与等级 | 查看卡片底部的好感、等级和经验条 |
| 切换临时模式 | 右键菜单选择陪玩、休息或结束临时模式 |
| 恢复鼠标交互 | `Ctrl` + `Alt` + `Shift` + `D`，或双击托盘图标 |
| 暂停动作 / 退出 | 使用角色或托盘右键菜单 |

缩放范围为原始尺寸的 25%–150%，屏幕较小时会适配可用区域。任务卡片和提问气泡保持文字可读，不随人物等比例缩小。

### 养成规则

点击互动可获得好感与经验：每次有效奖励增加 1 点好感、2 点经验，奖励冷却 10 秒，每日经验上限 30。好感范围为 0–100，等级随累计经验增长。

临时陪玩模式持续 30 分钟，休息模式持续 60 分钟；真实工作任务优先于这些临时模式。这里的“陪玩”是桌宠表现模式，尚不包含读取游戏画面、语音聊天或自动操作游戏。

## Codex 接入

### 三类信息，各自独立

| 信息 | 来源与行为 |
| --- | --- |
| 正在做什么 | 官方 Hooks 记录任务开始、工具操作、结束与中断等事件；卡片约每 750 毫秒刷新 |
| 剩余额度 | 通过可用的 Codex CLI 调用官方 app-server 只读额度接口，约每 120 秒刷新；失败或过期时显示未知 |
| 是否有新提问 | 从现有 `PreToolUse` / `PostToolUse` 回调识别支持的 `request_user_input` 和 `request_user_input_async` 调用 |

额度可读取，不代表任务 Hooks 已接通。任务卡片展示目录和粗粒度操作类型，不读取或展示模型的内部思考。

部分工具或客户端路径不经过这些 Hooks，因此**不能保证捕获全部提问，也不将所有权限审批视为已捕获**。提醒出现后，请回到 Codex 查看具体问题。

### 配置任务 Hooks

需要：可用且已登录的 Codex CLI，以及 **Node.js 24 或更高版本**。Windows 下，当前准备脚本要求 Node 可执行文件所在路径不含空格及 shell 特殊字符；不满足时会明确中止。

以下命令在项目根目录执行：

```powershell
# 生成当前项目位置对应的 Hook 定义
node .\outputs\dragon-codex-bridge-v4\prepare-hooks.mjs

# 预览安装计划，不修改配置
node .\outputs\dragon-codex-bridge-v4\install-hooks.mjs

# 确认路径正确后安装；原配置会备份，其他 Hook 条目会保留
node .\outputs\dragon-codex-bridge-v4\install-hooks.mjs --apply
```

然后打开 Codex CLI，在 `/hooks` 中审核并信任指向本项目 `hook.mjs` 的 8 项定义：

```text
UserPromptSubmit    PreToolUse       PostToolUse
SubagentStart       SubagentStop     Stop
Interrupt           SessionEnd
```

脚本不会自行修改信任记录。移动项目目录后，要重新生成、安装并审核新路径，同时核对旧路径条目，避免重复回调。

创建一次真实任务，确认卡片能从工作状态切换到结束状态。提问提醒只有在捕获到实际支持的事件后才出现，不会为了演示伪造真实请求。

参考：[Codex Hooks 文档](https://learn.chatgpt.com/docs/hooks) · [官方聊天入口](https://learn.chatgpt.com/docs/reference/commands) · [App Server 文档](https://learn.chatgpt.com/docs/app-server)

### 随 Codex 启动

完整项目提供 `outputs/dragon-companion-app-v4/codex-follower.js`。它每 3 秒观察一次进程，检测 Windows 商店版 Codex 桌面主进程启动后拉起 GPT娘。

若要配置到自己的电脑：

1. 为上述脚本创建快捷方式，目标程序为 `C:\Windows\System32\wscript.exe`，参数为脚本的完整路径（带引号）。
2. 将快捷方式放入当前用户的启动文件夹，可通过 `Win` + `R` → `shell:startup` 打开。
3. 双击一次快捷方式即可立即开始观察；之后随 Windows 登录启动。

观察器不修改 Codex 程序或 Hooks。已有桌宠实例时不重复启动；手动退出桌宠后，同一次 Codex 主进程运行期间不会立即重启。仅关闭窗口而保留 Codex 后台进程，不算重新启动。

关闭随启动：移除该快捷方式。立即停止观察器：在 `work/desktop-app-v4/` 创建 `follow-disabled.flag`；恢复时移除标志并重新运行快捷方式。此观察器目前针对 Windows 商店版 Codex，其他安装形式尚未验证。

## 完成情况

### 已实现

- 首个工作形态的真实 Cubism 模型和透明桌宠程序。
- 呼吸、尾巴、呆毛、鼠标与部分手指工作动作。
- 任务回调、只读额度、目录与操作卡片。
- 拖动、缩放、位置记忆、置顶与鼠标穿透。
- 好感、经验、等级、问候和临时模式。
- 粉白色提问提醒，以及新建 Codex 聊天入口。

### 仍待完成

- 精力满满、略疲惫、高度疲惫三个形态的独立 Live2D 模型。
- 更完整的眼部闭合、手部细节与表情绑定；当前自动动作保持双眼睁开。
- 更多状态对应的专属动作，以及更完整的原生宠物方向表现。
- macOS / Linux 适配和其他 Codex 安装形式验证。

**当前运行包仅包含首个工作模型。** 状态机能够分类，不代表四套 Live2D 差分已经全部制作完成。

### 状态规则

| 条件 | 逻辑状态 |
| --- | --- |
| 有任务或正在思考 | `working_thinking`：认真、略迷糊的工作状态 |
| 空闲，额度 > 50% | `idle_high_energy`：精神抖擞 |
| 空闲，15% ≤ 额度 ≤ 50% | `idle_mid_energy`：略有疲惫 |
| 空闲，额度 < 15% | `idle_low_energy`：非常疲惫 |
| 额度未知或过期 | 不猜测额度，使用未知 / 中性处理 |

50% 与 15% 的边界归入中间档，避免状态空档。早午晚问候、点击反馈、陪玩和休息作为临时表现逻辑处理，实际视觉效果仍受当前模型绑定范围限制。

## 项目结构

```text
GPT娘/
├─ README.md                         项目说明
├─ docs/images/                      README 配图
├─ outputs/
│  ├─ dragon-companion-app-v4/        Electron 桌宠、窗口、养成与启动逻辑
│  ├─ dragon-codex-bridge-v4/         Hooks、提问事件与额度读取
│  ├─ live2d-preview-v4/              Cubism Web 渲染、任务卡片与提示框
│  ├─ live2d-model-v4/                工作模型、贴图与模型配置
│  └─ live2d-runtime-v3/              状态分类与动作控制
└─ work/                             本机运行数据、制作资料和验证记录
```

技术组成：**Electron + JavaScript / ESM + Live2D Cubism SDK for Web**。养成和设置使用本地 JSON；Hook 并发写入使用 Node 内置 SQLite 锁。当前实现没有要求安装独立数据库服务。

独立桌宠直接渲染 Live2D。项目另有面向 Codex 原生宠物的动画图集产物，两者是不同入口；本运行包不会自动替换或激活 Codex 原生宠物。

<details>
<summary><strong>开发与验证</strong></summary>

完整源码与 Node.js 24 环境中，可运行相关检查：

```powershell
node --test .\outputs\dragon-codex-bridge-v4\hook.test.mjs .\outputs\dragon-codex-bridge-v4\question-notice.test.mjs
node --test .\outputs\dragon-companion-app-v4\window-interaction.test.cjs .\outputs\dragon-companion-app-v4\chat-link.test.cjs
```

发布构建脚本位于 `scripts/build-release.py`，使用明确的文件清单打包，并校验文件哈希及 ZIP 完整性。该构建脚本和测试文件位于源码仓库，不保证收录于便携运行包。构建前需按 runtime-provenance.json 准备对应 Electron 运行时。

v0.4.5 的校验包括：桥接事件隔离、提醒生命周期与内容最小化、会话选择、关闭与过期、窗口边界，以及隐藏 Electron 窗口中的真实模型加载与提示框关闭通信。测试未向真实聊天发送消息。

</details>

## 常见问题

<details>
<summary><strong>没有显示提问气泡？</strong></summary>

先确认 Hooks 已受信任、路径仍有效，并且这次提问使用了可被 Hook 捕获的工具。普通聊天文本中的问句不会触发提示。固定会话时，其他会话的提问不会弹出；提醒也可能已经关闭或超过 5 分钟。

</details>

<details>
<summary><strong>可以直接在桌宠里回答、追加要求或批准权限吗？</strong></summary>

当前版本只提醒。请在 Codex 原界面完成回答、追加要求与权限审核；任务卡片里的“新建聊天”也只负责打开新聊天输入界面。

</details>

<details>
<summary><strong>卡片一直显示“等待回调”或“额度未知”？</strong></summary>

检查 CLI 登录状态与 Hooks 安装、信任和路径。任务状态与额度是两套独立来源，需要分别验证。配置变更后可完整退出并重新打开 Codex。不要把额度未知理解为额度已经用完。

</details>

<details>
<summary><strong>命令提示符里切换 D 盘失败，或找不到 codex？</strong></summary>

Windows 命令提示符中切换盘符可输入 `D:`；切换盘符和目录可用 `cd /d "D:\tool\GPT娘"`，不要输入 `cd D`。PowerShell 中使用 `Set-Location 'D:\tool\GPT娘'`。

`codex` 未被识别通常表示 CLI 未安装或不在 PATH 中。安装可用的官方 CLI 后重新打开终端。桌面应用附带的内部可执行文件不一定是完整的独立 CLI 包，不应把强行运行它当作通用安装方式。

</details>

<details>
<summary><strong>桌宠无法点击或不在屏幕里？</strong></summary>

先用 `Ctrl` + `Alt` + `Shift` + `D` 恢复交互，再通过右键菜单重置位置和缩放。多显示器拔插后，程序会尝试把窗口放回可用屏幕。

</details>

<details>
<summary><strong>为什么提示框字体和截图不完全一样？</strong></summary>

提示框优先使用 Windows 的幼圆字体。不同系统的字体安装情况、缩放比例和颜文字后备字形可能不同；缺少字体时仍会正常显示。项目不附带系统字体文件。

</details>

## 本地数据与发布说明

运行数据位于 `work/desktop-app-v4/` 和 `work/codex-bridge-v4/`。目录、工具名和操作分类用于任务卡片；提问提醒只保存散列标识与时间，不保存题目正文、选项或用户答案。程序不代替用户批准请求。

`work/` 还可能含历史制作记录、旧版本测试数据和本机路径，**不要把整个制作工作区或完整备份直接公开上传**。公开仓库应选择程序源码、可发布模型、README 配图及必要依赖说明；便携运行包单独作为发布产物管理。

移动项目时，需要重新核对 Hooks 和随启动快捷方式；仅复制压缩包并不会迁移系统配置或信任记录。

## 素材、依赖与授权

角色图像包含 AI 辅助制作，Live2D 模型通过分层、绑定和 Cubism 导出流程制作。README 中的主视觉是角色素材预览，提问气泡配图来自本地程序渲染。

Electron、Chromium、Live2D Cubism 等第三方组件的许可证和声明随对应目录保留，参见 `outputs/live2d-preview-v4/vendor/` 及 Electron 运行时目录。本项目尚未指定覆盖全部自有代码与美术素材的统一开源许可证；公开展示不等于授予无限制的商用、再分发或再授权许可。

---

<div align="center">

**认真工作，也记得休息。**<br>
GPT娘会在桌边，陪你把下一件小事做好 ♡

</div>

# 开发检查

这部分用于修改项目后的验证，普通桌宠启动不需要安装开发依赖。

- 单元测试需要 Node.js 24 或更高版本。在项目根目录运行相应的 `node --test` 文件。
- 构建与压缩包检查使用 Python 3。相关脚本位于 `scripts/portable-bundle-v4`，目录保持原结构即可。
- 源码检查通过 `NODE_EXECUTABLE` 指定 Node.js，或使用系统已安装的 `node`。

## 模型检查与帧导出

`outputs/live2d-preview-v4/verify-models.mjs` 和 `render-frames.mjs` 分别提供模型检查和帧导出入口，配合已安装的 Playwright 与 Microsoft Edge 使用。它们通过 `DRAGON_PLAYWRIGHT_MODULE` 指定已有模块名称或模块目录，默认加载 `playwright`；可用 `DRAGON_BROWSER_CHANNEL` 选择已安装的浏览器通道，默认 `msedge`。

在 `outputs/dragon-companion-app-v4` 目录运行 `npm run model:check` 或 `npm run frames` 即可使用对应入口。生成的检查结果与帧保存在本地 `work` 目录，不会进入公开包。

## 任务云朵跳转检查

`bubble-jump-ui.mjs` 使用 Playwright 和已安装的 Microsoft Edge，在独立后台浏览器中验证以下行为：

1. 点击后先破碎，再打开原任务，约 6.5 秒后恢复仍运行的任务气泡。
2. 已结束任务保持收起，新活动恢复，无重复破碎。
3. 跳转失败恢复提示。
4. 拖动不跳转，切换监听任务时恢复新气泡。
5. 破碎过程中切换任务仍打开原来点击的任务。
6. 已结束任务的小 `×` 只破碎收起，不打开对话。

在项目根目录安装开发依赖 `npm install --no-save playwright`，然后运行 `node scripts/tests/bubble-jump-ui.mjs`。它只创建本地测试状态，不连接真实聊天、不发送消息，也不移动或操作桌宠。

已有 Playwright 环境时，可使用 `PLAYWRIGHT_MODULE` 指定模块名称或文件 URL。脚本没有固定某台机器的依赖路径。结果保存在 `work/qa/bubble-jump-ui-report.json`，不会进入公开发布包。

"""Build a self-contained Windows x64 GPT娘 portable archive from frozen outputs.

Only release files are admitted. Source artwork, personal state, logs and
machine-specific generated Codex hook configuration never enter the archive.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import zipfile

WORKSPACE = Path(__file__).resolve().parents[1]
OUTPUTS = WORKSPACE / "outputs"
BUILD = WORKSPACE / "work/release-build"
ARCHIVE_NAME = "GPT娘-Live2D桌宠-v4.zip"
APP = "dragon-companion-app-v4"
PREVIEW = "live2d-preview-v4"
BRIDGE = "dragon-codex-bridge-v4"
MODEL = "live2d-model-v4"

APP_FILES = [
    "main.cjs", "preload.cjs", "package.json", "start.cmd", "start.ps1", "question-notice.cjs", "codex-follower.js", "随Codex启动说明.txt",
    "state-bridge.mjs", "quota-service.mjs", "window-sizing.cjs", "window-interaction.cjs", "chat-link.cjs", "set-state.mjs",
    "life/index.mjs", "life/index.d.mts", "life/index.d.ts", "life/API.txt",
]
PREVIEW_FILES = [
    "app.mjs", "bindings.mjs", "controller.mjs", "index.html", "style.css",
    "model-catalog.mjs", "model-qa.mjs", "server.mjs", "binding-expectations.json",
    "pet-drag.mjs", "mini.html", "mini.css", "mini.mjs", "notice.html", "notice.css", "notice.mjs",
]
BRIDGE_FILES = ["hook.mjs", "task-details.mjs", "question-notice.mjs", "quota.mjs", "prepare-hooks.mjs", "install-hooks.mjs"]
RUNTIME_FILES = ["controller.mjs", "controller.d.mts", "controller.d.ts"]

README = """GPT娘 · Live2D 桌宠 v4.5（Windows x64 便携版）

启动
1. 将整个 ZIP 解压到可写文件夹，例如 D:\\tool\\GPT娘。
2. 双击最外层 start.cmd。请勿直接在压缩文件中启动，也不要只复制 EXE。
3. 包内已包含 Electron 与 Cubism Web 运行组件，正常启动不需要另装 Node.js、Python、Cubism Editor 或 npm 包。

缩放与操作
• 首次启动默认 180 × 200 逻辑像素，宽高均为旧版 540 × 600 的 1/3。
• 鼠标位于 GPT娘 上时，Ctrl + 滚轮缩放；右键菜单“缩放”可选比例、放大、缩小或恢复默认。
• 窗口获得焦点时，Ctrl + 加号/减号缩放，Ctrl + 0 恢复默认。
• 比例范围为旧版的 25%–150%，显示区域不足时会自动适配当前屏幕。比例会在本包的 work 文件夹保存。
• 按住角色、桌面或任务卡片文字区域自由拖动，位置自动保存。右键或托盘菜单支持置顶、鼠标穿透、暂停、问候、陪玩与休息。
• Ctrl + Alt + Shift + D 恢复显示和交互；托盘菜单“退出”会结束程序。

任务卡片
默认展示项目目录、真实操作、额度、好感度、等级和经验，每750毫秒刷新。
可下拉固定会话，悬停目录查看完整路径；自动模式跟随最近活跃会话。
点击“新建聊天”使用官方 codex://threads/new 入口，在当前跟随目录打开Codex新聊天，不自动发送消息。
右上角减号收起卡片；桌宠右键菜单“显示当前任务卡片”可恢复。卡片不随人物缩放，保持文字可读。
保留 v0.4.3 的简洁任务卡片，取消回复草稿、复制转交和追加要求输入区。
捕获到支持的提问事件时，在桌宠上方显示粉白提示框：“我有新的提问(｡･∀･)ﾉﾞ”。使用幼圆后备字体、爱心与轻微弹出动效，可关闭，最长保留5分钟。请回到Codex原界面回答。
Hooks保存目录、工具名、操作分类与散列标识；提问提醒不保存题目、选项或回答。具体功能和限制见根目录 README.md。公开发布时不要上传 work 目录。

本版内容
已包含首个工作形态的真实 Cubism moc3 模型，带呼吸、呆毛、尾巴、鼠标与手掌联动、食指敲键盘。
左眼暂按你的要求保持原状；自动动作保持双眼睁开。精力满满和疲惫形态尚未包含在本便携包中。
动作由本地程序驱动，模型源工程 cmo3 和分层 PSD 不在此运行包中。

Codex 状态
安装了可用且已登录的 Codex CLI 时，程序会尝试只读查询额度；未配置PATH时也会查找本机Codex安装目录。没有 CLI 时仍可显示并操作桌宠，额度显示未知。
任务状态接入需要另行配置 Codex Hooks；本包没有自动安装、信任或携带原电脑的 hooks.ready.json。
使用Node 24或更高版本运行 outputs/dragon-codex-bridge-v4/prepare-hooks.mjs，再运行同目录install-hooks.mjs --apply，可为本解压目录准备并安装定义；在Codex CLI /hooks中审核信任。移动目录后须重新配置。不要把首次安装等同于已验证真实回调。
独立 Live2D 桌宠与 Codex 内置宠物是两个运行入口；此 ZIP 不会改动 Codex 内置宠物目录。

数据与结构
outputs/ 内是必需的相对依赖目录，请一起保留。首次启动会创建 work/，用于本地设置、养成数据和运行日志。
首次解压不含其他电脑的个人状态。不同解压目录各自保存数据。
manifest.json 记录每个发布文件的 SHA-256。SDK、Electron 和 Chromium 许可证保留在对应 vendor/runtime 目录内。
"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def file_digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def collect_sources() -> dict[str, Path]:
    sources: dict[str, Path] = {}

    def add(relative: str) -> None:
        source = OUTPUTS / relative
        if not source.is_file() or source.is_symlink():
            raise RuntimeError(f"Required normal file is missing: {relative}")
        if not source.resolve().is_relative_to(OUTPUTS.resolve()):
            raise RuntimeError(f"Source escaped outputs: {relative}")
        sources["outputs/" + relative.replace("\\", "/")] = source

    for directory, names in [(APP, APP_FILES), (PREVIEW, PREVIEW_FILES),
                             (BRIDGE, BRIDGE_FILES), ("live2d-runtime-v3", RUNTIME_FILES)]:
        for name in names:
            add(f"{directory}/{name}")
    for directory in [f"{APP}/runtime/electron-44.5.1", f"{PREVIEW}/vendor"]:
        for source in sorted((OUTPUTS / directory).rglob("*")):
            if source.is_file():
                add(source.relative_to(OUTPUTS).as_posix())
    add("hd-v3/working_thinking.png")

    # Admit only the actual selected model and its declared runtime resources.
    model_name = "dragon-working.model3.json"
    add(f"{MODEL}/{model_name}")
    manifest = json.loads((OUTPUTS / MODEL / model_name).read_text(encoding="utf-8-sig"))

    def model_resources(value: object) -> None:
        if isinstance(value, str):
            relative = PurePosixPath(value.replace("\\", "/"))
            if relative.is_absolute() or ".." in relative.parts or ":" in value:
                raise RuntimeError(f"Invalid model resource path: {value}")
            add(f"{MODEL}/{relative.as_posix()}")
        elif isinstance(value, list):
            for entry in value:
                model_resources(entry)
        elif isinstance(value, dict):
            for key, entry in value.items():
                if key in ("Name", "FadeInTime", "FadeOutTime"):
                    continue
                model_resources(entry)

    model_resources(manifest["FileReferences"])
    required = [
        f"outputs/{APP}/runtime/electron-44.5.1/electron.exe",
        f"outputs/{APP}/runtime/electron-44.5.1/LICENSE",
        f"outputs/{APP}/runtime/electron-44.5.1/LICENSES.chromium.html",
        f"outputs/{PREVIEW}/vendor/Core/LICENSE.md",
        f"outputs/{PREVIEW}/vendor/Core/RedistributableFiles.txt",
        f"outputs/{PREVIEW}/vendor/Framework-LICENSE.md",
        f"outputs/{MODEL}/dragon-working.moc3",
    ]
    for name in required:
        if name not in sources:
            raise RuntimeError(f"Runtime or license missing: {name}")
    for name in sources:
        if any(part in {"work", "__pycache__", "node_modules", "validation"} for part in PurePosixPath(name).parts):
            raise RuntimeError(f"Non-release file entered allowlist: {name}")
        if name.endswith((".psd", ".cmo3", ".log", "hooks.ready.json")):
            raise RuntimeError(f"Excluded personal/source file entered allowlist: {name}")
    return sources


def generated_files() -> dict[str, bytes]:
    launcher = '@echo off\r\ncall "%~dp0outputs\\dragon-companion-app-v4\\start.cmd"\r\n'
    runtime_provenance = json.loads((OUTPUTS / APP / "runtime-provenance.json").read_text(encoding="utf-8-sig"))
    runtime_provenance["runtimePath"] = "runtime/electron-44.5.1"
    runtime_provenance.pop("installedAt", None)
    return {"start.cmd": launcher.encode("ascii"), "使用说明.txt": README.replace("\n", "\r\n").encode("utf-8-sig"),
            "README.md": (WORKSPACE / "README.md").read_bytes(),
            "docs/images/gpt-niang.png": (WORKSPACE / "docs/images/gpt-niang.png").read_bytes(),
            "docs/images/question-notice.png": (WORKSPACE / "docs/images/question-notice.png").read_bytes(),
            f"outputs/{APP}/runtime-provenance.json": json_bytes(runtime_provenance)}


def validate_local_imports(sources: dict[str, Path]) -> None:
    # Every literal relative module import in shipped JS must resolve inside the
    # allowlist; dynamic model/texture/shader resources are checked separately.
    pattern = re.compile(r"(?:\bfrom\s+|\bimport\s*\(|\brequire\s*\()(['\"])(\.[^'\"]+)\1")
    for name, source in sources.items():
        if source.suffix not in {".js", ".mjs", ".cjs"}:
            continue
        for _quote, reference in pattern.findall(source.read_text(encoding="utf-8-sig")):
            target = source.parent.joinpath(reference).resolve()
            try:
                key = "outputs/" + target.relative_to(OUTPUTS.resolve()).as_posix()
            except ValueError:
                raise RuntimeError(f"Import outside package: {name} -> {reference}")
            if key not in sources:
                raise RuntimeError(f"Missing imported module: {name} -> {reference}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    sources = collect_sources()
    generated = generated_files()
    validate_local_imports(sources)
    total_bytes = sum(source.stat().st_size for source in sources.values()) + sum(map(len, generated.values()))
    summary = {"archive": ARCHIVE_NAME, "sourceFiles": len(sources), "generatedFiles": len(generated),
               "uncompressedBytes": total_bytes, "portableNormalLaunchNeedsNode": False,
               "defaultWindow": {"width": 180, "height": 200, "scale": 1 / 3},
               "excluded": ["PSD", "cmo3", "work state and logs", "generated hooks.ready.json", "unexported variants"]}
    if args.plan:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return
    BUILD.mkdir(parents=True, exist_ok=True)
    temporary = BUILD / (ARCHIVE_NAME + ".partial")
    if temporary.exists():
        raise RuntimeError(f"An earlier partial archive exists; preserve and inspect it first: {temporary}")
    entries = []
    with zipfile.ZipFile(temporary, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for name, source in sorted(sources.items()):
            before = source.stat()
            source_hash = file_digest(source)
            archive.write(source, name)
            after = source.stat()
            if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
                raise RuntimeError(f"Source changed while packing: {name}")
            entries.append({"path": name, "bytes": after.st_size, "sha256": source_hash})
        for name, content in sorted(generated.items()):
            archive.writestr(name, content)
            entries.append({"path": name, "bytes": len(content), "sha256": digest(content)})
        manifest = {"name": "GPT娘", "version": "0.4.5", "platform": "win32-x64",
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                    "normalEntryPoint": "start.cmd", "files": entries, "packaging": summary}
        archive.writestr("manifest.json", json_bytes(manifest))
    with zipfile.ZipFile(temporary) as archive:
        expected = {entry["path"] for entry in entries} | {"manifest.json"}
        if set(archive.namelist()) != expected or len(archive.namelist()) != len(expected):
            raise RuntimeError("Archive entries do not match the release manifest")
        for entry in entries:
            content = archive.read(entry["path"])
            if len(content) != entry["bytes"] or digest(content) != entry["sha256"]:
                raise RuntimeError(f"Archive hash mismatch: {entry['path']}")
        corrupt = archive.testzip()
        if corrupt:
            raise RuntimeError(f"Archive CRC failed: {corrupt}")
    target = OUTPUTS / ARCHIVE_NAME
    backup = None
    if target.exists():
        stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup = target.with_name(f"{target.stem}-previous-{stamp}{target.suffix}")
        if backup.exists():
            raise RuntimeError("Backup name already exists; no archive overwritten")
        target.rename(backup)
    temporary.rename(target)
    archive_hash = file_digest(target)
    hash_file = OUTPUTS / (ARCHIVE_NAME + ".sha256")
    hash_file.write_text(f"{archive_hash}  {ARCHIVE_NAME}\n", encoding="utf-8")
    report = {**summary, "verifiedAt": datetime.now(timezone.utc).isoformat(), "entries": len(entries) + 1,
              "archiveBytes": target.stat().st_size, "sha256": archive_hash,
              "allEntryHashesVerified": True, "crcVerified": True,
              "previousArchive": backup.name if backup else None,
              "runtimeLaunchValidation": "pending extracted-package smoke check"}
    (OUTPUTS / "GPT娘-便携包校验.json").write_bytes(json_bytes(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

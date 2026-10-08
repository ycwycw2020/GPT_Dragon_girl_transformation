"""Build a self-contained Windows x64 GPT_Dragon_girl_transformation portable archive from frozen outputs.

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

WORKSPACE = Path(__file__).resolve().parents[2]
OUTPUTS = WORKSPACE / "outputs"
BUILD = Path(__file__).resolve().parent
VERSION = "1.0.0"
ARCHIVE_NAME = f"GPT_Dragon_girl_transformation-v{VERSION}.zip"
APP = "dragon-companion-app-v4"
PREVIEW = "live2d-preview-v4"
BRIDGE = "dragon-codex-bridge-v4"
MODEL = "live2d-model-v4"

APP_FILES = [
    "main.cjs", "preload.cjs", "package.json", "start.cmd", "start.ps1", "question-notice.cjs", "codex-follower.js", "随Codex启动说明.txt",
    "state-bridge.mjs", "quota-service.mjs", "window-sizing.cjs", "window-interaction.cjs", "chat-link.cjs", "conversation-navigation.cjs", "task-follow.cjs", "set-state.mjs", "codex-rest-control.mjs", "rest-wakeup.mjs",
    "life/index.mjs", "life/index.d.mts", "life/index.d.ts", "life/API.txt", "virtual-desktops.cjs", "virtual-desktops.ps1",
]
PREVIEW_FILES = [
    "app.mjs", "ambient-motion.mjs", "touch-interactions.mjs", "source-textures.mjs", "leg-repair.mjs", "leg-motion.mjs", "brow-repair.mjs", "idle-rig.mjs", "eye-blink.mjs", "assets/left-eye/43_eye_L_closed.png", "assets/left-eye/45_eye_L_upperlash.png", "assets/left-eye/47_eye_L_skin_base.png", "assets/left-eye/49_eye_L_stationary_eye.png", "assets/left-eye/blink-geometry.json", "assets/reference-working.png", "assets/legs-corrected.png", "assets/notebook.png", "assets/earring-mask.png", "bindings.mjs", "controller.mjs", "index.html", "style.css",
    "model-catalog.mjs", "model-qa.mjs", "server.mjs", "binding-expectations.json", "affection-reactions.mjs", "reaction-visuals.mjs", "extra-touch.mjs",
    "pet-drag.mjs", "view-presentation.mjs", "task-bubble-state.mjs", "mini.html", "mini.css", "mini.mjs", "notice.html", "notice.css", "notice.mjs",
]
BRIDGE_FILES = ["hook.mjs", "task-details.mjs", "assistant-activity.mjs", "question-notice.mjs", "quota.mjs", "prepare-hooks.mjs", "install-hooks.mjs", "global-threads.mjs", "task-transcript.mjs", "merge-task-sources.mjs"]
RUNTIME_FILES = ["controller.mjs", "controller.d.mts", "controller.d.ts"]

README = f"""GPT_Dragon_girl_transformation · v{VERSION} · Windows x64

安装：将整个 ZIP 解压到可写目录，双击最外层 start.cmd。
运行包自带 Electron 与 Cubism Web 组件，无须安装 Node.js、Python 或 Cubism Editor。
程序不占用底部任务栏，系统托盘小图标提供操作菜单与退出入口。

使用：按住角色或桌面拖动；Ctrl + 滚轮缩放；右键或托盘切换状态、监听任务、查看好感与休息。
首次默认 180×200 逻辑像素；在屏幕右侧自动镜像，气泡文字保持正向。
Ctrl + Alt + Shift + D 可恢复显示与交互。

v1.0 全局任务监听：只读当前 Codex 本地索引、任务历史与受限日志元数据，发现不同 C/D 盘目录下最近最多200个未归档主聊天。菜单使用 Codex 的聊天名称，并按独立聊天编号区分。
“切换监听任务”可选择自动跟随或固定某个聊天，选择会保存。气泡只显示简短工作状态；点击跳回对应聊天。
点击云朵先破碎一次再跳转；从点击起约6.5秒后，该聊天仍在工作才重新显示，已结束的任务保持收起。
全局任务发现不依赖项目日期或项目所在目录；额度与部分提问/输出通知仍需可用的 Codex CLI / Hooks。
Hooks 必须由使用者审核信任，安装步骤见 docs/installation.md。没有 Hooks 时也可发现本机聊天；本包不会自动信任任何 Hook。
提问提示：“我有新的提问(｡･∀･)ﾉﾞ”；点击在 Codex 中处理。问题正文和回答不会复制到桌宠。

角色保留工作、三档精力与休息形态、双眼眨动、小幅呼吸、尾巴、腿部与触碰互动。
90种分档反应随好感等级解锁；Lv.100 显示 MAX。配音已移除。
休息无倒计时，新开始的 Codex 任务可唤醒。当前休息无法停止 Codex 内项目，需在 Codex 手动停止。
工作态为真实 Cubism 模型配合程序增强；其他形态和部分互动为本程序的局部图层形变，并非独立 moc3。

文件：完整使用介绍见 README.md；安装见 docs/installation.md；新版本说明见 docs/release-v1.0.md。
首次启动创建 work/ 保存本机偏好、养成和运行记录；公开上传时不包含个人 work/。
完整工程包另含最新分层 PSD、Cubism 工程、原画及开发脚本；便携包用于直接运行。
manifest.json 为发布文件 SHA-256 清单。第三方许可证位于 vendor/runtime 相应目录。
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
    add(f"{PREVIEW}/assets/source-layers/manifest.json")
    original_layers = json.loads((OUTPUTS / PREVIEW / "assets/source-layers/manifest.json").read_text(encoding="utf-8"))
    for layer in original_layers["layers"]:
        name = layer["file"]
        if PurePosixPath(name).name != name or ":" in name:
            raise RuntimeError("Invalid original layer asset path")
        add(f"{PREVIEW}/assets/source-layers/{name}")
    for directory in ["idle", "brow-repair", "reactions"]:
        asset_root = OUTPUTS / PREVIEW / "assets" / directory
        if not asset_root.is_dir():
            raise RuntimeError(f"Runtime artwork missing: {directory}")
        for source in sorted(asset_root.rglob("*")):
            if source.is_file():
                if source.name == "README.md":
                    continue  # Authoring provenance is kept in the project.
                if source.suffix.lower() not in {".png", ".json"}:
                    raise RuntimeError(f"Unexpected runtime artwork file: {source}")
                add(source.relative_to(OUTPUTS).as_posix())

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
            "docs/installation.md": (WORKSPACE / "docs/installation.md").read_bytes(),
            "docs/release-v1.0.md": (WORKSPACE / "docs/release-v1.0.md").read_bytes(),
            "docs/affection-reactions.md": (WORKSPACE / "docs/affection-reactions.md").read_bytes(),
            "docs/touch-guide.md": (WORKSPACE / "docs/touch-guide.md").read_bytes(),
            "docs/codex-rest-control.md": (WORKSPACE / "docs/codex-rest-control.md").read_bytes(),
            "docs/window-presentation.md": (WORKSPACE / "docs/window-presentation.md").read_bytes(),
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


def validate_release_boundary(sources: dict[str, Path], generated: dict[str, bytes]) -> None:
    """Reject authoring media and secret/private identity data at the release edge."""
    excluded_parts = {"work", "__pycache__", "node_modules", "validation", ".git", ".codex", ".agents"}
    excluded_suffixes = {".psd", ".cmo3", ".log", ".wav", ".mp3", ".m4a", ".aac", ".mp4", ".flac", ".ogg", ".opus"}
    private_text = re.compile(
        r"sk-(?:api|proj)-[A-Za-z0-9_-]{20,}|gptgirl-bili-[A-Za-z0-9_-]+|"
        r"[\"']voice_?id[\"']\s*:\s*[\"']|work[\\/]voice-v[0-9]+[\\/]|"
        r"reference[\\/]chatgpt-reference\.wav", re.IGNORECASE)
    text_suffixes = {".txt", ".json", ".md", ".js", ".cjs", ".mjs", ".html", ".css", ".ps1", ".cmd", ".ts", ".mts"}
    entries = {**sources, **generated}
    for name, content in entries.items():
        path = PurePosixPath(name)
        if (any(part in excluded_parts or part == "voice" or part.startswith(("voice-v", "voice-auditions")) for part in path.parts)
                or path.name in {"touch-voice.mjs", "voice-settings.cjs", "voice-guide.md"}
                or path.suffix.lower() in excluded_suffixes or path.name == "hooks.ready.json"):
            raise RuntimeError(f"Private/authoring file entered release: {name}")
        if path.suffix.lower() not in text_suffixes:
            continue
        data = content.read_bytes() if isinstance(content, Path) else content
        if private_text.search(data.decode("utf-8-sig")):
            # Never report a matched secret or private service ID.
            raise RuntimeError(f"Secret/private authoring data entered release text: {name}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plan", action="store_true")
    args = parser.parse_args()
    sources = collect_sources()
    package = json.loads((OUTPUTS / APP / "package.json").read_text(encoding="utf-8"))
    if package.get("version") != VERSION:
        raise RuntimeError("Package version differs from the release archive version")
    generated = generated_files()
    validate_local_imports(sources)
    validate_release_boundary(sources, generated)
    total_bytes = sum(source.stat().st_size for source in sources.values()) + sum(map(len, generated.values()))
    summary = {"archive": ARCHIVE_NAME, "sourceFiles": len(sources), "generatedFiles": len(generated),
               "uncompressedBytes": total_bytes, "portableNormalLaunchNeedsNode": False,
               "defaultWindow": {"width": 180, "height": 200, "scale": 1 / 3},
               "audioIncluded": False, "voiceFeaturesIncluded": False,
               "excluded": ["PSD", "cmo3", "work state and logs", "generated hooks.ready.json", "unexported variants",
                            "all dubbing audio, audition records, voice runtime modules and settings",
                            "reference media, private service ids, prompts and API keys"]}
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
        manifest = {"name": "GPT_Dragon_girl_transformation", "version": json.loads((OUTPUTS / APP / "package.json").read_text(encoding="utf-8"))["version"], "platform": "win32-x64",
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
    (OUTPUTS / "GPT_Dragon_girl_transformation-便携包校验.json").write_bytes(json_bytes(report))
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

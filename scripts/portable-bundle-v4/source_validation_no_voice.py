"""Validate the current no-voice release without packaging or launching."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

import build_portable as release


def main():
    sources = release.collect_sources()
    release.validate_local_imports(sources)
    generated = release.generated_files()
    release.validate_release_boundary(sources, generated)
    package = json.loads((release.OUTPUTS / release.APP / "package.json").read_text(encoding="utf-8"))
    assert package["version"] == release.VERSION
    assert release.ARCHIVE_NAME == f"GPT_Dragon_girl_transformation-v{release.VERSION}.zip"
    required = {
        f"outputs/{release.APP}/conversation-navigation.cjs",
        f"outputs/{release.APP}/task-follow.cjs",
        f"outputs/{release.APP}/state-bridge.mjs",
        f"outputs/{release.PREVIEW}/extra-touch.mjs",
        f"outputs/{release.PREVIEW}/task-bubble-state.mjs",
        f"outputs/{release.PREVIEW}/leg-motion.mjs",
        f"outputs/{release.PREVIEW}/eye-blink.mjs",
        f"outputs/{release.BRIDGE}/assistant-activity.mjs",
        f"outputs/{release.BRIDGE}/global-threads.mjs",
        f"outputs/{release.BRIDGE}/task-transcript.mjs",
        f"outputs/{release.BRIDGE}/merge-task-sources.mjs",
    }
    assert required <= sources.keys(), sorted(required - sources.keys())
    assert {"README.md", "docs/touch-guide.md", "docs/affection-reactions.md", "docs/codex-rest-control.md", "docs/window-presentation.md"} <= generated.keys()
    assert "docs/voice-guide.md" not in generated
    for relative in (
        f"{release.PREVIEW}/assets/voice", f"{release.PREVIEW}/touch-voice.mjs",
        f"{release.APP}/voice-settings.cjs",
    ):
        assert not (release.OUTPUTS / relative).exists(), f"Removed voice runtime still exists: {relative}"
    removed_bindings = re.compile(r"touch-voice|voice-settings|assets/voice|dragon:voice|(?:get|set|on)Voice|touchVoice")
    for relative in (f"{release.PREVIEW}/app.mjs", f"{release.APP}/main.cjs", f"{release.APP}/preload.cjs"):
        assert not removed_bindings.search((release.OUTPUTS / relative).read_text(encoding="utf-8-sig")), f"Removed voice binding remains: {relative}"
    # Check the actual shipped reaction records; this does not create touch
    # events, use an account, write personal state, or access the network.
    node = os.environ.get("NODE_EXECUTABLE") or shutil.which("node")
    if not node:
        raise RuntimeError("Install Node.js 24+ or set NODE_EXECUTABLE before source validation")
    catalog = subprocess.run(
        [node, "--input-type=module", "--eval",
         "import {REACTIONS} from './outputs/live2d-preview-v4/affection-reactions.mjs'; console.log(JSON.stringify(REACTIONS.map(({id,target,tier,unlockLevel})=>({id,target,tier,unlockLevel}))));"],
        cwd=release.WORKSPACE, capture_output=True, text=True, encoding="utf-8", check=True, timeout=30)
    reactions = json.loads(catalog.stdout)
    assert len(reactions) == 90 and len({reaction["id"] for reaction in reactions}) == 90
    groups = {}
    for reaction in reactions:
        assert 1 <= reaction["unlockLevel"] <= 10
        group = (reaction["target"], reaction["tier"])
        groups[group] = groups.get(group, 0) + 1
    assert len({target for target, _tier in groups}) == 6 and len(groups) == 18
    assert set(groups.values()) == {5}, "Every touch target and affection tier must retain five reactions"
    entries = []
    for name, source in sorted(sources.items()):
        before = source.stat()
        checksum = release.file_digest(source)
        after = source.stat()
        assert (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns), f"Source changed during validation: {name}"
        entries.append({"path": name, "bytes": after.st_size, "sha256": checksum, "source": "allowlist"})
    for name, content in sorted(generated.items()):
        entries.append({"path": name, "bytes": len(content), "sha256": release.digest(content), "source": "generated-at-package-time"})
    report = {
        "name": "GPT_Dragon_girl_transformation", "version": package["version"], "archive": release.ARCHIVE_NAME,
        "checkedAt": datetime.now(timezone.utc).isoformat(), "status": "no-voice-source-snapshot-validated-not-packaged",
        "sourceFiles": len(sources), "generatedFiles": len(generated), "uncompressedBytes": sum(entry["bytes"] for entry in entries),
        "localImportsResolved": True, "requiredRuntimeModulesIncluded": sorted(required),
        "audioIncluded": False, "voiceFeaturesIncluded": False, "reactionCount": len(reactions),
        "touchTargets": 6, "affectionTiers": 3, "reactionsPerTargetTier": 5,
        "archiveCreated": False, "installed": False, "files": entries,
    }
    target = Path(__file__).with_name(f"source-manifest-no-voice-v{release.VERSION.replace('.', '')}.json")
    target.write_bytes(release.json_bytes(report))
    print(json.dumps({key: value for key, value in report.items() if key != "files"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

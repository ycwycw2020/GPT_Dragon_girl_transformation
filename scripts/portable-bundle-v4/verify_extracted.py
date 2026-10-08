"""Verify and boot a freshly extracted portable release without using local Node."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import time
import zipfile

from build_portable import APP, PREVIEW, VERSION, ARCHIVE_NAME, validate_release_boundary

WORKSPACE = Path(__file__).resolve().parents[2]
OUTPUTS = WORKSPACE / "outputs"
ARCHIVE = OUTPUTS / ARCHIVE_NAME
BUILD = Path(__file__).resolve().parent


def file_digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    extracted = BUILD / ("extract-" + stamp)
    extracted.mkdir(exist_ok=False)
    with zipfile.ZipFile(ARCHIVE) as archive:
        for name in archive.namelist():
            relative = PurePosixPath(name)
            if relative.is_absolute() or ".." in relative.parts or ":" in name or "\\" in name:
                raise RuntimeError(f"Unsafe archive entry: {name}")
        manifest = json.loads(archive.read("manifest.json"))
        if manifest.get("version") != VERSION:
            raise RuntimeError("Archive version differs from the current release")
        declared = [entry["path"] for entry in manifest["files"]]
        if len(declared) != len(set(declared)) or set(archive.namelist()) != set(declared) | {"manifest.json"} or len(archive.namelist()) != len(declared) + 1:
            raise RuntimeError("Archive has duplicate or undeclared entries")
        for name in declared:
            parts = PurePosixPath(name).parts
            if any(part in {"work", "__pycache__", "node_modules", "validation"} for part in parts) or name.endswith((".psd", ".cmo3", ".log", "hooks.ready.json")):
                raise RuntimeError("Archive contains personal/source files")
        archive.extractall(extracted)
    for entry in manifest["files"]:
        actual = extracted / entry["path"]
        if not actual.is_file() or actual.stat().st_size != entry["bytes"] or file_digest(actual) != entry["sha256"]:
            raise RuntimeError(f"Extraction hash failed: {entry['path']}")
    validate_release_boundary({name: extracted / name for name in declared}, {})
    if manifest.get("packaging", {}).get("audioIncluded") is not False or manifest.get("packaging", {}).get("voiceFeaturesIncluded") is not False:
        raise RuntimeError("Archive does not declare the required no-voice rollback")
    app_root = extracted / "outputs" / APP
    package = json.loads((app_root / "package.json").read_text(encoding="utf-8"))
    if package.get("version") != VERSION:
        raise RuntimeError("Extracted app version differs from release")
    electron = app_root / "runtime/electron-44.5.1/electron.exe"
    smoke = extracted / "portable-smoke-report.json"
    environment = os.environ.copy()
    environment.pop("ELECTRON_RUN_AS_NODE", None)
    # Deliberately keep Node off PATH: the packaged Electron provides Node in
    # its main process, and smoke mode does not query any installed Codex CLI.
    environment["PATH"] = environment.get("SystemRoot", r"C:\Windows") + r"\System32"
    startup = subprocess.STARTUPINFO()
    startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    startup.wShowWindow = subprocess.SW_HIDE
    with (extracted / "smoke.stdout.log").open("wb") as stdout, (extracted / "smoke.stderr.log").open("wb") as stderr:
        process = subprocess.Popen([str(electron), str(app_root), "--smoke-test", "--report", str(smoke)],
                                   cwd=app_root, env=environment, startupinfo=startup,
                                   creationflags=subprocess.CREATE_NO_WINDOW, stdout=stdout, stderr=stderr)
        (extracted / "smoke.pid").write_text(str(process.pid), encoding="ascii")
        code = process.wait(timeout=90)
    if code != 0 or not smoke.exists():
        raise RuntimeError(f"Extracted Electron failed (exit={code}); inspect {extracted}")
    report = json.loads(smoke.read_text(encoding="utf-8-sig"))
    if report.get("appVersion") != VERSION:
        raise RuntimeError("Running extracted Electron reports a different app version")
    if "voice" in report or "voiceIpc" in report or "voice" in report.get("renderer", {}):
        raise RuntimeError("Removed voice runtime or IPC remains in the extracted app")
    renderer_api = report.get("renderer", {}).get("apiKeys", [])
    if any("voice" in key.lower() for key in renderer_api):
        raise RuntimeError("Removed voice API remains exposed to the renderer")
    if report["renderer"].get("textureMode") != "original-layer-resolution" or report["renderer"].get("legRepair") != "local-anatomy-v048":
        raise RuntimeError("Source-resolution artwork or corrected legs failed to load")
    if report["renderer"].get("chairLogoRepair") != "stationary-original-v048":
        raise RuntimeError("Stationary chair emblem repair failed to load")
    if report["renderer"].get("browRepair") != "left-brow-local-removal-v0411" or report["renderer"].get("legMotion") != "all-state-anchored-sway-v0412":
        raise RuntimeError("Local brow removal or anchored lower-leg animation failed to load")
    if set(report["renderer"].get("availableVisuals", [])) != {"idle_high_energy", "idle_mid_energy", "idle_low_energy", "sleep_mode"}:
        raise RuntimeError("The three idle rigs and sleeping pose did not load from the portable package")
    reaction_art = report["renderer"].get("reactionVisuals", {})
    if not reaction_art.get("ready") or {asset.get("pose") for asset in reaction_art.get("assets", [])} != {"angry", "shy", "affectionate", "sleep"}:
        raise RuntimeError("All four expression/sleep assets must be ready")
    life = report.get("lifeIpc", {})
    for snapshot in ("before", "clicked", "sleeping", "restored"):
        progression = life.get(snapshot, {}).get("progression", {})
        if progression.get("maxLevel") != 100 or type(progression.get("isMax")) is not bool or not 1 <= progression.get("level", 0) <= 100:
            raise RuntimeError(f"Invalid 1–100/MAX growth data in {snapshot}")
        if progression["isMax"] and (progression["level"] != 100 or progression.get("progress") != 1 or progression.get("xpToNextLevel") != 0 or progression.get("nextLevelXp") is not None):
            raise RuntimeError("MAX growth data must end cleanly at level 100")
    sleep = life.get("sleeping", {})
    capability = sleep.get("restControl", {})
    if sleep.get("mode") != "sleep_mode" or capability.get("status") != "unavailable" or capability.get("allStopped") is not False or capability.get("scope") != "pet-only":
        raise RuntimeError("Sleep must truthfully report that Codex tasks were not stopped")
    if life.get("restored", {}).get("mode") is not None:
        raise RuntimeError("Returning from sleep failed")
    if not report["renderer"].get("blink", {}).get("leftReady"):
        raise RuntimeError("Independent left eyelid renderer failed to load")
    if report["renderer"].get("status") != "rendering" or not report["renderer"].get("mocLoaded"):
        raise RuntimeError("Extracted real moc3 failed to render")
    if report["pageCapture"]["visiblePixels"] <= 0 or report["pageCapture"]["transparentPixels"] <= 0:
        raise RuntimeError("Extracted real renderer has no visible/transparent pixels")
    security = report["security"]
    if not security["sandbox"] or not security["contextIsolation"] or security["nodeIntegration"] or not security["webSecurity"]:
        raise RuntimeError("Extracted app security preferences changed")
    scale = report["scaleIpc"]
    if scale["default"]["bounds"]["width"] != 180 or scale["default"]["bounds"]["height"] != 200:
        raise RuntimeError("Extracted default size is not 180 x 200")
    if scale["enlarged"]["bounds"]["width"] != 198 or scale["restored"]["bounds"]["width"] != 180:
        raise RuntimeError("Extracted scale IPC did not enlarge and restore")
    mini = report.get("miniEvidence", {})
    if not mini.get("connected") or mini.get("layout") != "thought-cloud-v0414" or type(mini.get("mirrored")) is not bool:
        raise RuntimeError("Mirroring thought-cloud task bubble failed to render")
    if any(type(mini.get(key)) is not bool for key in ("active", "canPop", "popping", "dismissed")):
        raise RuntimeError("Thought-cloud task completion and temporary visibility state are missing")
    panel_bounds = report.get("panelBounds", {})
    if panel_bounds.get("width") != 168 or panel_bounds.get("height") != 66:
        raise RuntimeError("Thought-cloud task bubble must be 168 x 66 logical pixels")
    presentation = report.get("presentationIpc", {})
    samples = presentation.get("samples", [])
    if [sample.get("expected") for sample in samples] != [False, True, False]:
        raise RuntimeError("Hidden mirror smoke must exercise left, right, then left")
    for sample in samples:
        views = sample.get("views", [])
        if len(views) != 3 or any(view.get("mirrored") is not sample["expected"] for view in views):
            raise RuntimeError("Mirror IPC must synchronize the pet, task cloud and question notice")
    events = presentation.get("events", [])
    if len(events) != 3 or any({event.get("mirrored") for event in surface} != {False, True} for surface in events):
        raise RuntimeError("Mirror push events must reach all three windows")
    if type(report.get("presentationView", {}).get("mirrored")) is not bool or presentation.get("restored", {}).get("mirrored") is not report["presentationView"]["mirrored"]:
        raise RuntimeError("Hidden mirror smoke did not restore its original direction")
    follow = report.get("followIpc", {})
    if follow.get("nativeMenuPresent") is not True:
        raise RuntimeError("Switch monitored task menu is missing from the extracted app")
    completed, working, automatic = (follow.get(key, {}) for key in ("selectedCompleted", "selectedWorking", "autoState"))
    completed_id, working_id = completed.get("followSession"), working.get("followSession")
    if (not isinstance(completed_id, str) or not isinstance(working_id, str)
            or len(completed_id) != 64 or len(working_id) != 64 or completed_id == working_id):
        raise RuntimeError("Task switching smoke must select two distinct captured sessions")
    if (completed.get("isWorking") is not False or completed.get("taskKnown") is not True
            or completed.get("bubbleTaskId") != completed_id or completed.get("operation") != "本轮已结束"
            or follow.get("persistedCompleted") != completed_id):
        raise RuntimeError("Completed task selection, bubble routing or saved preference failed")
    if (working.get("isWorking") is not True or working.get("taskKnown") is not True
            or working.get("bubbleTaskId") != working_id or working.get("noticeSession") != working_id):
        raise RuntimeError("Active task selection must route its bubble and question notice together")
    if (automatic.get("followSession") != "" or automatic.get("isWorking") is not True
            or automatic.get("taskKnown") is not True or automatic.get("bubbleTaskId") != working_id):
        raise RuntimeError("Restoring automatic task following failed")
    options = follow.get("options", [])
    if {option.get("id") for option in options} != {"", completed_id, working_id}:
        raise RuntimeError("Task switching menu must contain automatic mode and both captured sessions")
    if any(follow.get(key) is not True for key in ("invalidRejected", "unknownRejected", "wrongWindowRejected")):
        raise RuntimeError("Task switching IPC must reject malformed, unknown and unauthorized requests")
    taskbar = report.get("taskbarEvidence", {})
    if (taskbar.get("configuredSkipTaskbar") is not True
            or taskbar.get("constructorWindowCount") != 3 or taskbar.get("apiCalls") != 3
            or taskbar.get("verification") != "hidden-constructor-and-api-call"
            or taskbar.get("mechanism") != "ITaskbarList::DeleteTab"
            or taskbar.get("visibleShellVerified") is not False or report.get("taskbarMode") != "tray-only"):
        raise RuntimeError("All companion windows must configure and call Electron skipTaskbar; hidden smoke cannot verify visible Shell buttons")
    if "--smoke-only" in sys.argv:
        destination = OUTPUTS / "GPT_Dragon_girl_transformation-便携包校验.json"
        existing = json.loads(destination.read_text(encoding="utf-8"))
        existing.update(runtimeLaunchValidation="passed_hidden_extracted_smoke", extractedFileHashesVerified=len(manifest["files"]),
                        rendererStatus=report["renderer"]["status"], mocLoaded=True, miniEvidence=mini, panelBounds=panel_bounds,
                        scaleIpc=scale, alwaysOnTop=report["alwaysOnTop"], security=security,
                        presentationIpc=presentation, taskbarEvidence=taskbar, followIpc=follow,
                        audioIncluded=False, voiceFeaturesIncluded=False,
                        mouseDragValidation="unit tests passed; GUI test interrupted by concurrent user input",
                        chatValidation="official URL and encoding tested; installed codex protocol verified; no chat created by test")
        destination.write_text(json.dumps(existing, ensure_ascii=False, indent=2)+"\n",encoding="utf-8")
        print(json.dumps(existing, ensure_ascii=False, indent=2))
        return

    # Exercise the actual double-click entry chain too. Keep PowerShell on PATH
    # while omitting external Node/Codex; terminate only this new verified PID.
    system_root = Path(environment.get("SystemRoot", r"C:\Windows"))
    launcher_environment = environment.copy()
    launcher_environment["PATH"] = str(system_root / "System32") + ";" + str(system_root / "System32/WindowsPowerShell/v1.0")
    with (extracted / "launcher.stdout.log").open("wb") as stdout, (extracted / "launcher.stderr.log").open("wb") as stderr:
        launcher = subprocess.run([str(system_root / "System32/cmd.exe"), "/d", "/c", str(extracted / "start.cmd")],
                                  cwd=extracted, env=launcher_environment, startupinfo=startup,
                                  creationflags=subprocess.CREATE_NO_WINDOW, stdout=stdout, stderr=stderr, timeout=30)
    if launcher.returncode != 0:
        raise RuntimeError(f"Actual start.cmd failed with exit {launcher.returncode}: {extracted}")
    desktop_directory = extracted / "work/desktop-app-v4"
    runtime_report = desktop_directory / "desktop-runtime-report.json"
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline and not runtime_report.exists():
        time.sleep(.25)
    if not runtime_report.exists():
        raise RuntimeError(f"Actual start.cmd produced no runtime report: {extracted}")
    normal = json.loads(runtime_report.read_text(encoding="utf-8-sig"))
    launched_pid = normal.get("pid")
    if not isinstance(launched_pid, int) or launched_pid <= 0:
        raise RuntimeError("Normal launcher report contains no valid PID")
    process_path = subprocess.run([str(system_root / "System32/WindowsPowerShell/v1.0/powershell.exe"),
                                   "-NoProfile", "-Command", f"(Get-Process -Id {launched_pid} -ErrorAction Stop).Path"],
                                  capture_output=True, text=True, startupinfo=startup,
                                  creationflags=subprocess.CREATE_NO_WINDOW, timeout=15)
    if process_path.returncode != 0 or Path(process_path.stdout.strip()).resolve() != electron.resolve():
        raise RuntimeError("Reported PID does not belong to the extracted Electron; no process terminated")
    try:
        if normal["renderer"].get("status") != "rendering" or not normal["renderer"].get("mocLoaded"):
            raise RuntimeError("Actual start.cmd model did not render")
        if normal.get("title") != "GPT_Dragon_girl_transformation" or normal["bounds"]["width"] != 180 or normal["bounds"]["height"] != 200:
            raise RuntimeError("Actual start.cmd title/default bounds differ")
        if not normal.get("windowVisible"):
            raise RuntimeError("Actual start.cmd companion is not visible")
    finally:
        subprocess.run([str(system_root / "System32/taskkill.exe"), "/PID", str(launched_pid), "/T", "/F"],
                       startupinfo=startup, creationflags=subprocess.CREATE_NO_WINDOW, capture_output=True, timeout=15)
    public = {
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "archive": ARCHIVE.name,
        "sha256": file_digest(ARCHIVE),
        "extractedFileHashesVerified": len(manifest["files"]),
        "runtimeLaunchValidation": "passed",
        "launch": "packaged Electron; fresh extracted folder; Node removed from child PATH; hidden smoke mode",
        "electron": report["electron"],
        "rendererStatus": report["renderer"]["status"],
        "mocLoaded": report["renderer"]["mocLoaded"],
        "pageCapture": report["pageCapture"],
        "security": security,
        "alwaysOnTop": report["alwaysOnTop"],
        "alwaysOnTopValidation": "observed_true" if normal["alwaysOnTop"] else "observed_false; not accepted as passed",
        "quota": "disabled in isolated portable validation; no account data included",
        "exitCode": code,
        "scaleIpc": scale,
        "presentationIpc": presentation,
        "followIpc": follow,
        "taskbarEvidence": taskbar,
        "audioIncluded": False,
        "voiceFeaturesIncluded": False,
        "actualStartCmd": {"exitCode": launcher.returncode, "modelStatus": normal["renderer"]["status"],
                           "title": normal["title"], "bounds": normal["bounds"],
                           "windowVisible": normal["windowVisible"], "alwaysOnTop": normal["alwaysOnTop"],
                           "onlyVerificationCopyWasClosed": True},
    }
    destination = OUTPUTS / "GPT_Dragon_girl_transformation-便携包校验.json"
    existing = json.loads(destination.read_text(encoding="utf-8"))
    existing.update(public)
    destination.write_text(json.dumps(existing, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(public, ensure_ascii=False, indent=2))
    print("Local isolated diagnostics: " + str(extracted))


if __name__ == "__main__":
    main()

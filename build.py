import subprocess
import sys


def build():
    build_suffix = get_rust_target()
    command = [
        sys.executable,
        "-m",
        "PyInstaller",
        f"--name=populator-{build_suffix}",
        "--onefile",
        "--distpath=sidecar",
        "--hidden-import=cryptography",
        "--noconfirm",
        "--clean",
        "--noconsole",
        "cli.py",
    ]

    process = subprocess.Popen(
        command,
        stdout=sys.stdout,
        stderr=sys.stderr,
    )

    returncode = process.wait()
    if returncode == 0:
        print("✅ PyInstaller build completed.")
    else:
        print(f"❌ PyInstaller build failed with code {returncode}.")
        sys.exit(returncode)


def get_rust_target():
    try:
        output = subprocess.check_output(["rustc", "-vV"], text=True)
        for line in output.splitlines():
            if line.startswith("host:"):
                return line.split(":", 1)[1].strip()
    except Exception as e:
        print(f"⚠️ Couldn't detect Rust target: {e}")
        return "unknown"


if __name__ == "__main__":
    build()

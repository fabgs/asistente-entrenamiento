"""Signs the release APK with key rotation, so a phone whose Entreno was signed with the old key
(the React Native template's public debug key, up to 1.4.3) accepts it as an update and keeps its
data. APK Signature Scheme v3: Android 9+ uses the app's own key with the proof that the old key
handed over to it (signing/entreno-rotation.lineage); older versions keep the old key.

Run after `cd android && ./gradlew assembleRelease`:

    python scripts/sign_release.py [android/app/build/outputs/apk/release/app-release.apk]

The app's key and its password come from ~/.gradle/gradle.properties (ENTRENO_UPLOAD_*), never
from the repo. Every release from 1.4.4 on goes through this script.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APK = ROOT / 'android/app/build/outputs/apk/release/app-release.apk'
OLD_KEYSTORE = ROOT / 'android/app/debug.keystore'  # public: React Native template, copied by prebuild
LINEAGE = ROOT / 'signing/entreno-rotation.lineage'
# Key rotation only exists from Android 9 (API 28).
ROTATION_MIN_SDK = '28'


def sdk_dir() -> Path:
    for candidate in (os.environ.get('ANDROID_HOME'), os.environ.get('ANDROID_SDK_ROOT')):
        if candidate:
            return Path(candidate)
    return Path(os.environ['LOCALAPPDATA']) / 'Android' / 'Sdk'


def apksigner() -> Path:
    tools = sorted((sdk_dir() / 'build-tools').iterdir(), key=lambda p: [int(x) for x in re.findall(r'\d+', p.name)])
    name = 'apksigner.bat' if os.name == 'nt' else 'apksigner'
    return tools[-1] / name


def signing_properties() -> dict:
    props = {}
    path = Path.home() / '.gradle' / 'gradle.properties'
    for line in path.read_text(encoding='utf-8').splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            key, value = line.split('=', 1)
            props[key.strip()] = value.strip()
    missing = [k for k in ('ENTRENO_UPLOAD_STORE_FILE', 'ENTRENO_UPLOAD_KEY_ALIAS', 'ENTRENO_UPLOAD_STORE_PASSWORD') if k not in props]
    if missing:
        sys.exit(f'Faltan {", ".join(missing)} en {path}')
    return props


def main() -> None:
    apk = Path(sys.argv[1]) if len(sys.argv) > 1 else APK
    for f in (apk, OLD_KEYSTORE, LINEAGE):
        if not f.exists():
            sys.exit(f'No existe {f}')
    props = signing_properties()
    tool = str(apksigner())
    env = {**os.environ, 'ENTRENO_PASS': props['ENTRENO_UPLOAD_STORE_PASSWORD']}
    signed = apk.with_name(apk.stem + '-rotated.apk')
    subprocess.run(
        [
            tool, 'sign',
            '--lineage', str(LINEAGE),
            '--rotation-min-sdk-version', ROTATION_MIN_SDK,
            '--ks', str(OLD_KEYSTORE), '--ks-key-alias', 'androiddebugkey',
            '--ks-pass', 'pass:android', '--key-pass', 'pass:android',
            '--next-signer',
            '--ks', props['ENTRENO_UPLOAD_STORE_FILE'], '--ks-key-alias', props['ENTRENO_UPLOAD_KEY_ALIAS'],
            '--ks-pass', 'env:ENTRENO_PASS', '--key-pass', 'env:ENTRENO_PASS',
            '--out', str(signed), str(apk),
        ],
        check=True,
        env=env,
    )
    signed.replace(apk)
    result = subprocess.run([tool, 'verify', '--verbose', '--print-certs', str(apk)], capture_output=True, text=True, check=True)
    for line in result.stdout.splitlines():
        if line.startswith(('Verifies', 'Verified using', 'Signer #')) and ('SHA-256' in line or 'Verif' in line):
            print(line)
    print(f'Firmado con rotación: {apk}')


if __name__ == '__main__':
    main()

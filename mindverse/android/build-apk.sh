#!/usr/bin/env bash
# Build a signed, installable Mindverse APK without Gradle, straight from the
# Android SDK build tools. Output: mindverse/android/build/mindverse.apk
#
# Needs: JDK 11+, and ANDROID_HOME pointing at an SDK with
#   build-tools;35.0.0 and platforms;android-35
#   (sdkmanager "build-tools;35.0.0" "platforms;android-35")
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/android-sdk}}"
BT="$SDK/build-tools/35.0.0"
JAR="$SDK/platforms/android-35/android.jar"
OUT="$HERE/build"
VERSION_NAME="$(node -p "require('$APP/package.json').version")"
VERSION_CODE="${VERSION_CODE:-$(git -C "$APP" rev-list --count HEAD 2>/dev/null || echo 1)}"

[ -f "$JAR" ] || { echo "Android platform 35 not found under $SDK (set ANDROID_HOME)"; exit 1; }

echo "» web bundle"
(cd "$APP" && npm run --silent build:artifact)

rm -rf "$OUT" && mkdir -p "$OUT"/{assets,gen,classes,dex}
cp "$APP/dist-artifact/mindverse.html" "$OUT/assets/index.html"

echo "» resources"
"$BT/aapt2" compile --dir "$HERE/res" -o "$OUT/res.zip"
"$BT/aapt2" link -o "$OUT/unsigned.apk" -I "$JAR" \
  --manifest "$HERE/AndroidManifest.xml" -A "$OUT/assets" "$OUT/res.zip" \
  --java "$OUT/gen" --min-sdk-version 24 --target-sdk-version 34 \
  --version-code "$VERSION_CODE" --version-name "$VERSION_NAME" \
  -0 html   # store the page uncompressed for a faster first load

echo "» java"
javac --release 11 -nowarn -cp "$JAR" -d "$OUT/classes" \
  $(find "$HERE/src" "$OUT/gen" -name '*.java')
"$BT/d8" --release --min-api 24 --lib "$JAR" --output "$OUT/dex" $(find "$OUT/classes" -name '*.class')
(cd "$OUT/dex" && zip -q -j "$OUT/unsigned.apk" classes.dex)

echo "» sign"
"$BT/zipalign" -p -f 4 "$OUT/unsigned.apk" "$OUT/aligned.apk"
KS="${MINDVERSE_KEYSTORE:-$HERE/mindverse.keystore}"
KS_PASS="${MINDVERSE_KEYSTORE_PASS:-mindverse}"
if [ ! -f "$KS" ]; then
  # Updates only install over an APK signed with the same key: keep this file.
  keytool -genkeypair -keystore "$KS" -storepass "$KS_PASS" -keypass "$KS_PASS" \
    -alias mindverse -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=Mindverse, O=Mindverse" 2>/dev/null
fi
"$BT/apksigner" sign --ks "$KS" --ks-pass "pass:$KS_PASS" --ks-key-alias mindverse \
  --out "$OUT/mindverse.apk" "$OUT/aligned.apk"
"$BT/apksigner" verify "$OUT/mindverse.apk"
rm -f "$OUT/unsigned.apk" "$OUT/aligned.apk" "$OUT/aligned.apk.idsig" "$OUT/mindverse.apk.idsig"

echo "✓ $OUT/mindverse.apk ($(du -h "$OUT/mindverse.apk" | cut -f1)) v$VERSION_NAME ($VERSION_CODE)"

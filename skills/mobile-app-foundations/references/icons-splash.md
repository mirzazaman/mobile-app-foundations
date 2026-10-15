# App icons & splash screens — reference

Verified 2026-10-15. The Expo behaviour comes from reading `@expo/prebuild-config` 54.0.x and 55.0.x (`expo-splash-screen` and `icons` plugins) and the Expo docs. The Android figures come from developer.android.com and androidx core-splashscreen. Re-check with `scripts/check-assets.mjs`: it reads the installed plugin's defaults and warns if they change.

## Contents
1. Why it looks different in Expo Go, after prebuild, and on each phone
2. Asset specs (what to export)
3. Expo config (complete example)
4. Splash sizing maths
5. Workflow: generate → check → preview → rebuild → verify
6. Hiding the splash without a flash
7. Bare React Native
8. Caches and quirks

---

## 1. Why it looks different

| Where you look | What you actually see |
|---|---|
| **Expo Go** | Since SDK 52, Expo Go shows your **app icon** instead of your splash, and never installs your launcher icon. It tells you nothing about either. |
| **Dev client** (`expo-dev-client`) | The dev client's own splash; not all splash properties apply. |
| **Prebuild / release build** | The real thing, generated into `android/` and `ios/` by the config plugins. Judge only this. |
| **Android 12+ (and older Android through androidx core-splashscreen)** | The SplashScreen API shows the icon in a 288 dp area, **cropped to a 192 dp circle**. Expo never sets an icon background. |
| **iOS** | A storyboard with your image at `imageWidth` pt, centred, **no crop**. |
| **Android launchers** | Adaptive icons are cropped by the launcher's mask: circle (Pixel), squircle (Samsung), rounded square, and others. The mask animates, too. |

Common causes of "different size":
- **Legacy config.** You used the top-level `"splash"` key, a bare `"expo-splash-screen"` string, or gave only an `android: {}` block. iOS then shows the image **full-screen**, while Android shows a 200 dp logo cropped to the circle.
- **Splash image has a large transparent margin.** The image is "contain"-fitted into `imageWidth`, so padding shrinks the logo on both platforms.
- **`imageWidth` too big.** At, say, `imageWidth: 288` the image fills the whole Android canvas, so the circle cuts the logo's edges and it looks zoomed in.
- **Opaque square as the splash image.** Using the app icon or a logo on a baked background as the splash image: on Android it becomes a cropped disc.
- **Stale native folders.** Running prebuild without `--clean`, or reinstalling without uninstalling first.

## 2. Asset specs

| File | Spec | Why |
|---|---|---|
| `icon.png` (iOS / universal) | 1024×1024 PNG, **opaque**, full-bleed square, no rounded corners, no padding ring | iOS applies its own corner mask. Expo flattens transparency onto **white**, and App Store Connect rejects alpha (ITMS-90717). |
| `ios.icon.dark` | 1024×1024, logo on a **transparent** background | iOS 18 draws the dark backdrop itself. |
| `ios.icon.tinted` | 1024×1024 greyscale version | iOS 18 tinted mode. Optional. |
| Icon Composer `.icon` | `ios.icon: "./assets/app.icon"` (a string, not an object) | iOS 26 Liquid Glass layered icon. SDK 54+, build with Xcode 26. |
| `adaptive-icon.png` (foreground) | 1024×1024, **transparent**, logo inside the **centre 61% circle**: radius ≤ 0.61 × 512 ≈ 313 px, i.e. a ~626 px diameter, ~200 px clear margin | The 108 dp layer only shows 72 dp, and only the 66 dp centre is safe under every mask and parallax motion. Expo scales the 1024 image to the full 108 dp layer. |
| `adaptiveIcon.backgroundColor` / `backgroundImage` | A colour, or an opaque 1024×1024 PNG | Defaults to `#FFFFFF` if unset. Set it explicitly. |
| `adaptiveIcon.monochromeImage` | 1024×1024 silhouette on transparency, same safe circle | Android 13+ themed icons use only its alpha. Android 16 QPR2 auto-themes icons that lack it, with worse results. |
| `splash-icon.png` | Transparent square PNG of **just the logo**, cropped to the logo with ~4–5% margin; ≥ 3 × `imageWidth` px (e.g. ≥ 600 px) | Size it with `imageWidth`, not padding. |
| Notification icon (Android) | 96×96 **white silhouette on transparency** | Android uses only alpha. An opaque image shows as a white square. |

**Don't** reuse the iOS icon (an opaque full-bleed square) as the adaptive foreground or as the splash image.

**Fastest route to a correct set:** `node <skill>/scripts/check-assets.mjs --make logo.png --out assets/brand --bg "#HEX" --dark-bg "#HEX" --preview /tmp/brand-preview`. It generates every file above from one transparent logo, centred on the logo's content, then checks them and prints the `app.json` snippet with a safe `imageWidth`.

## 3. Expo config (complete example)

```jsonc
{
  "expo": {
    "userInterfaceStyle": "automatic",          // or "light"; the dark splash/icon only apply with automatic
    "backgroundColor": "#F7F7F3",               // root view (expo-system-ui) = splash bg = first screen bg
    "icon": "./assets/brand/icon.png",
    "ios": {
      "icon": { "light": "./assets/brand/icon.png", "dark": "./assets/brand/icon-dark.png" }
    },
    "android": {
      "adaptiveIcon": {
        "foregroundImage": "./assets/brand/adaptive-icon.png",
        "monochromeImage": "./assets/brand/monochrome-icon.png",
        "backgroundColor": "#F7F7F3"
      }
    },
    "plugins": [
      ["expo-splash-screen", {
        "image": "./assets/brand/splash-icon.png",
        "imageWidth": 180,                       // explicit; the default is 100. Max for this image comes from check-assets
        "resizeMode": "contain",
        "backgroundColor": "#F7F7F3",
        "dark": { "image": "./assets/brand/splash-icon-dark.png", "backgroundColor": "#121212" }
      }]
    ]
  }
}
```

Rules for the splash block:
- Keep options at the **top level** of the plugin config. `android` / `ios` sub-objects are only for real per-platform differences.
- Never rely on a bare string or on the legacy `"splash"` key.
- `resizeMode` doesn't affect the Android logo; it's always "contain".
- Undocumented extras exist (`tabletImage`, Android `drawable`, per-density keys) but are rarely needed.
- **SDK 55 template:** `create-expo-app` ships an Android-only splash block (`android.image`, `imageWidth: 76`), so iOS shows only the background colour. Decide deliberately, and usually move the options to the top level.

## 4. Splash sizing maths

What Expo does with the image:
- **Android:** contain-fits the image into an `imageWidth`×`imageWidth` dp square and centres it on a 288 dp canvas. The system shows only the centre 192 dp circle (radius 96 dp).
- **iOS:** draws the same square at `imageWidth` pt.

So the logo is safe on Android when:

```
(farthest logo pixel from the image centre, in px) × imageWidth / (image's longest side, in px)  ≤  96 dp
```

| Logo shape (cropped tight) | Safe `imageWidth` (approx.) |
|---|---|
| Round mark | ≤ ~185 |
| Square mark, filling its canvas | ≤ ~130 (192/√2 ≈ 136, minus margin) |
| 3:1 wordmark | ≤ ~180, and it will look short; consider a mark-only splash |
| Logo with 20% transparent padding | Bigger numbers fit, but the logo looks smaller on iOS. Crop the padding instead. |

`check-assets.mjs` prints the exact maximum for your file ("max safe imageWidth ≈ N"). Pick a value at or below it that also looks right on iOS: typically 150–200 pt for a mark.

react-native-bootsplash (bare RN) applies the same Android 12 rule. It warns above 134 dp ("might be cropped") and skips Android generation above 192 dp.

## 5. Workflow

1. Generate or fix the assets. Use `--make` from one logo, or edit them by hand to the specs above.
2. `node <skill>/scripts/check-assets.mjs . --preview /tmp/asset-preview` until there's no ❌. **Open the preview PNGs** (Read tool) and look: launcher masks, the 192 dp splash circle, the iOS rounded icon.
3. `npx expo prebuild --clean`. Without `--clean`, prebuild layers changes over old native files. With EAS and CNG (no committed `android/`/`ios/`), the build does this for you.
4. Uninstall the old app from the simulator/emulator/device, then install a **preview or release build**:
   - `npx expo run:android --variant release`
   - `npx expo run:ios --configuration Release`
   - or `eas build --profile preview`
5. Verify:
   - Android: the launcher icon on a Pixel-style circle mask, with themed icons on (Wallpaper & style → Themed icons).
   - Android: the splash, by cold-starting **from the launcher icon**.
   - iOS: the home screen in light, dark and tinted modes (long-press the home screen → Edit → Customize).
   - iOS: the launch screen, by cold-starting the app.

## 6. Hiding the splash without a flash

```tsx
// app/_layout.tsx
import * as SplashScreen from 'expo-splash-screen';
SplashScreen.preventAutoHideAsync();              // module scope, before any render

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { (async () => { await loadFontsAndSession(); setReady(true); })(); }, []);
  const onLayout = useCallback(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
  if (!ready) return null;                         // native splash stays up meanwhile
  return <View style={{ flex: 1, backgroundColor: colors.background }} onLayout={onLayout}>…</View>;
}
```
- Hide only after the first real frame has laid out (`onLayout`), not just when the data arrives.
- Use the same colour for the splash `backgroundColor`, the root `backgroundColor` (expo-system-ui) and the first screen. Otherwise there's a white flash between them.

## 7. Bare React Native

**Splash: react-native-bootsplash v7**
```bash
npx react-native-bootsplash generate assets/logo.png --platforms=android,ios --background=F7F7F3 --logo-width=150 --assets-output=assets/bootsplash
```
- `--logo-width` is in dp at @1x, default 100. Keep it ≤ 134 for square marks.
- Dark variants and brand images need a license key.
- Check the logo with `check-assets.mjs --file assets/logo.png --role splash --image-width 150`.
- RN < 0.80 uses the older bootsplash docs.

**Icons**
- Android: Android Studio → New → Image Asset. It generates adaptive icons (foreground, background, **monochrome** tab), legacy and round icons, and the Play 512 icon. Keep the logo inside the safe-zone guide it shows.
- iOS: Xcode → AppIcon → "Single Size" 1024×1024 opaque. Add dark/tinted appearances if wanted.
- Check the source PNGs with `--file … --role ios-icon | adaptive-foreground | adaptive-monochrome`.

## 8. Caches and quirks

- **iOS launch screen cache.** iOS caches the launch screen. If an old splash persists, delete the app, restart the simulator/device, and reinstall. On SDK ≤ 52, `npx expo run:ios --no-build-cache` was the documented fix. This is practical advice, not an official doc.
- **Android launcher icon cache.** Uninstall and reinstall. If the old icon persists, restart the launcher or the device.
- **Android 12/12L.** The splash icon doesn't show when the app is launched from Android Studio, adb, Settings → App info, or some third-party launchers (fixed in Android 13). Test by tapping the launcher icon.
- **Dev client.** Its splash isn't yours. Don't tune `imageWidth` against it.

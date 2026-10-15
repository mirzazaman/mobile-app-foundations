---
name: mobile-app-foundations
description: Rules, drop-in templates and automated checks that stop the recurring React Native / Expo bugs — content under the notch, Dynamic Island, status bar or Android gesture/3-button nav bar (or double padding); inputs and submit buttons hidden by the keyboard, forms that don't scroll to the focused field, no Next/Done; app icons and splash screens that look different in Expo Go vs prebuild vs real phones, or get cropped/oversized on circle vs squircle launchers. Use it whenever creating a new React Native or Expo app, adding or changing any screen, form, TextInput, header, footer or bottom button, touching SafeAreaView/insets/KeyboardAvoidingView/keyboard behaviour, editing app.json icon/adaptiveIcon/splash config or assets, running expo prebuild, or fixing any layout bug on iOS/Android — even when the user doesn't say "safe area" or "keyboard".
---

# Mobile app foundations (React Native / Expo)

Three bug families keep coming back across apps, and the fixes are known — they just get skipped:

1. **Safe areas** — content under the notch / Dynamic Island / status bar, buttons under the Android gesture or 3-button bar, or the opposite: a double gap because two things padded the same edge.
2. **Keyboard** — the focused input or the submit button sits under the keyboard, "Next" does nothing, the first tap on Submit only closes the keyboard, number pads have no Done key.
3. **Icons & splash** — right in Expo Go, wrong after prebuild; oversized or cropped on Android circle launchers; different size on iOS vs Android.

This skill makes the fixes the default. Read the section for what you're touching; open the matching reference file for detail and code.

## Step 0 — know the stack before writing layout code

Look before assuming; several rules depend on versions.

```bash
node -e 'const p=require("./package.json");const d={...p.dependencies,...p.devDependencies};for(const k of ["expo","react-native","expo-router","@react-navigation/native","react-native-safe-area-context","react-native-keyboard-controller","react-native-reanimated","@gorhom/bottom-sheet","expo-splash-screen","react-native-bootsplash"])console.log(k.padEnd(34),d[k]??"—")'
grep -s edgeToEdgeEnabled android/gradle.properties   # bare RN only
```

- **Android is edge-to-edge on Expo SDK ≥ 54** (always on, cannot be disabled) **and on every Android 15/16 device** whatever the app config. The app draws under the status and navigation bars; you must pad with insets. `StatusBar backgroundColor/translucent` do nothing there (and the props are removed in RN 0.87).
- **Bare RN 0.81–0.83 templates ship `edgeToEdgeEnabled=false`** but Android 15/16 devices force edge-to-edge anyway → set it to `true` so every Android version behaves the same.
- **keyboard-controller version is pinned by the Expo SDK** (`npx expo install` → SDK 54: 1.18.5, SDK 55: 1.20.7). Newer APIs (KeyboardToolbar compound API ≥1.19, KeyboardChatScrollView ≥1.21, `mode` ≥1.21.4) won't exist. Check the installed version before using them; `scripts/audit-ui.mjs` flags violations.
- These facts were verified on 2026-10-15 for Expo SDK 54/55, RN 0.81–0.83 (latest then: SDK 57, RN 0.87). On a newer stack, re-check anything version-specific.

## Task routing

| Task | Do this |
|---|---|
| Starting a new app | Follow `references/new-app-setup.md`, copy `templates/` into the app, run both scripts before the first build. |
| New or changed screen | Decide edge ownership (below), pick the keyboard pattern (below), use the `Screen` / `FormScreen` primitives, run the verify checklist. |
| Fixing a reported layout/keyboard bug | Run `node <skill>/scripts/audit-ui.mjs <app>` to find every instance, read the relevant reference, fix at the shared primitive rather than one screen with a magic number. |
| Icons / splash work | Run `node <skill>/scripts/check-assets.mjs <app> --preview /tmp/asset-preview`, **open the preview PNGs and look**, fix (or regenerate the whole set from one transparent logo with `--make logo.png --out assets/brand --bg "#HEX"`), then `npx expo prebuild --clean` and check in a release/preview build. Details: `references/icons-splash.md`. |

`<skill>` = the directory this SKILL.md was loaded from (e.g. `~/.claude/skills/mobile-app-foundations` for a local Claude Code install; elsewhere wherever the skill is mounted).

## Safe areas — rules

Full detail, ownership table and edge cases: `references/safe-area.md`.

1. **One owner per edge.** For each screen decide who pads top, bottom, left, right — exactly one owner each. A visible stack header owns the top. A visible tab bar owns the bottom. A bottom sheet owns its own bottom. Everything else, the screen owns. Two owners = double gap; zero owners = content under the notch or the gesture bar. Write the decision down as the `edges` prop of the screen container (the `Screen` template makes `edges` required for exactly this reason).
2. **Only `react-native-safe-area-context`.** Never `SafeAreaView` from `react-native` (iOS-only, deprecated since 0.81, does nothing on Android). Never hard-coded 20/44/47/59/34, `StatusBar.currentHeight`, `isIphoneX`-style helpers — insets differ per device, orientation and Android nav mode.
3. **One `SafeAreaProvider` at the root.** expo-router already provides it — don't add another at the root. Add a nested provider only at the root of an iOS modal/formSheet/pageSheet route or inside RN `<Modal>` content, where the root's insets are wrong (e.g. `useSafeAreaInsets()` reports the 59 pt window top inside a sheet that starts below the status bar).
4. **Scrolling content: bottom inset goes inside the content** (`contentContainerStyle.paddingBottom`), so the list scrolls under the home indicator but the last item can rise above it. Fixed footers: the container owns the inset and the button keeps its own ≥12 pt padding, so devices with a 0 inset (iPhone SE) still get breathing room.
5. **Android draws behind the bars**: colour the status-bar area by letting your header's background extend under it (`paddingTop: insets.top` on the coloured view); set the bar icon style with `expo-status-bar` `style`. Give the bottom inset to anything pinned to the bottom — 3-button nav is ~48 dp, gesture nav ~24 dp.
6. **Landscape / iPad** (`ios.supportsTablet: true` is on in most Expo templates): left/right insets matter in landscape. Either handle `left`/`right` edges or lock orientation deliberately.
7. **Pick one technique per screen** — the `useSafeAreaInsets()` hook (React Navigation recommends it; no jumps during transitions) *or* `<SafeAreaView edges>` (native, no rotation lag). Mixing both on one screen causes flicker.

## Keyboard — rules

Full detail, code for each pattern, bottom sheets, chat, Android specifics: `references/keyboard.md`.

1. **Every input lives in a keyboard-aware container**, chosen per screen:

| Screen | Use |
|---|---|
| Form, or any input that can be below the fold | `KeyboardAwareScrollView` (keyboard-controller) with `bottomOffset` — scrolls to the focused field on focus *and* on focus change, multiline growth and caret moves. `FormScreen` template. |
| Form whose primary button must float on the keyboard (login, OTP, amount entry, checkout) | `KeyboardAwareScrollView` + footer in `KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}`; `bottomOffset = footerHeight + gap` so the focused field stays above the floating button. `FormScreen footerMode="sticky"`. |
| Long form with the button at the end | Button as the last child of the `KeyboardAwareScrollView`. `FormScreen footerMode="inline"`. |
| Chat / composer | `KeyboardChatScrollView` (≥1.21) or keyboard-controller `KeyboardAvoidingView behavior="translate-with-padding"` (≥1.16.5) — see reference. |
| Input in a bottom sheet | `BottomSheetTextInput`, `keyboardBehavior="interactive"`, `keyboardBlurBehavior="restore"`, `android_keyboardInputMode="adjustResize"`. |

2. **Use `react-native-keyboard-controller`**, wrapped once in `<KeyboardProvider>` at the root (without it the components silently do nothing). React Native's own `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}` is the classic broken copy-paste: under Android edge-to-edge the window is no longer resized, so Android gets no handling at all. Don't stack two mechanisms on one screen (KAV + KeyboardAwareScrollView = double gap / jumps).
3. **The submit button must work on the first tap with the keyboard open**: `keyboardShouldPersistTaps="handled"` on *every* ScrollView/FlatList that is an ancestor of the inputs or the button (the library never sets it; RN's default `"never"` eats the first tap).
4. **Chain the fields**: `returnKeyType="next"` + `submitBehavior="submit"` + `onSubmitEditing → next.focus()`; the last field `returnKeyType="done"`/`"go"`/`"send"` and submits. `templates/useFocusChain.ts` does this. `blurOnSubmit` is deprecated — use `submitBehavior`.
5. **iOS number/phone/decimal pads have no return key** — give them `returnKeyType="done"` (RN then adds a Done bar on iOS) or a `KeyboardToolbar`, not both.
6. **When layout changes under a focused field** (validation message appears), call the scroll view ref's `assureFocusedInputVisible()` (keyboard-controller ≥ 1.20, i.e. not on SDK 54's 1.18.5 — there, keep error text from changing the field's position, e.g. reserve its line).
7. **Android**: `android.softwareKeyboardLayoutMode` stays `"resize"` (the default); `"pan"` slides the whole window and pushes the header off-screen.
8. Don't wrap screens in `TouchableWithoutFeedback onPress={Keyboard.dismiss}` — it breaks scrolling and accessibility; `keyboardShouldPersistTaps="handled"` already dismisses on taps in empty space.

## Icons & splash — rules

Why things differ, exact geometry, bare-RN equivalents: `references/icons-splash.md`.

1. **Never judge icons or splash in Expo Go or a dev client.** Expo Go shows the app icon instead of your splash (SDK 52+) and never installs your launcher icon; dev clients show their own splash. Check in a preview/release build after `npx expo prebuild --clean`, with the old app uninstalled first.
2. **Splash config lives in the `expo-splash-screen` plugin with shared top-level options** — `image`, `imageWidth`, `backgroundColor`, `dark`. The legacy top-level `"splash"` key, a bare `"expo-splash-screen"` string, or giving only an `android: {}` block all fall back to the legacy path: iOS shows the image full-screen while Android shows a 200 dp logo in a circle.
3. **Splash geometry (Android 12+ API, used on all versions):** Expo draws the image `contain`-ed into an `imageWidth`×`imageWidth` dp square on a 288 dp canvas, and Android shows only the centre **192 dp circle**. iOS shows the same square at `imageWidth` pt with no mask. So: transparent square PNG cropped tight to the logo (~5% margin), size it with `imageWidth` (not with padding), and keep the logo's farthest pixel within 96 dp of centre — about `imageWidth ≤ 180` for a round mark, `≤ 130` for a square mark. `check-assets.mjs` computes the exact maximum for your image. Never use a full-screen 1242×2688 splash design or the opaque app icon as the splash image.
4. **iOS icon**: 1024×1024, opaque, full-bleed square, no pre-rounded corners (Expo flattens transparency onto white; App Store rejects alpha). Optional `ios.icon: { light, dark, tinted }` (dark may be transparent), or an Icon Composer `.icon` for iOS 26 (SDK 54+, built with Xcode 26).
5. **Android adaptive icon**: separate `foregroundImage` (1024, transparent) and `backgroundColor`/`backgroundImage`. The logo must stay inside the centre **61% circle** of the canvas (66 of 108 dp; ≈626 px diameter on 1024, ≈200 px margin per side) — launchers crop to circles, squircles or rounded squares. Add `monochromeImage` (silhouette, same safe zone) for Android 13+ themed icons. Don't reuse the full-bleed iOS icon as the foreground.
6. **One background colour** shared by splash `backgroundColor`, root `backgroundColor` (expo-system-ui) and the first screen, so there is no white flash between them; add `dark` variants when `userInterfaceStyle` is `"automatic"`.

## Mistakes models make here (check your own diff for these)

- `import { SafeAreaView } from 'react-native'`; wrapping a screen that has a header in `SafeAreaView` with default (all) edges → double top gap; adding `insets.bottom` on a tab screen → gap above the tab bar.
- `useSafeAreaInsets()` inside an iOS sheet/modal → top padding as if full screen.
- Hard-coded `paddingTop: 44` / `StatusBar.currentHeight` / `Platform.OS === 'ios' ? 20 : 0`.
- `KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}` and a guessed `keyboardVerticalOffset={64}`.
- Forgetting `keyboardShouldPersistTaps="handled"` → Submit needs two taps.
- `KeyboardStickyView` without `offset` while the footer pads the bottom inset → extra gap above the keyboard.
- Using keyboard-controller APIs newer than the SDK-pinned version.
- Several inputs, no Next chain; number pad with no Done.
- Top-level `"splash"` key, `imageWidth: 288`, full-screen splash PNG, splash image with an opaque background, icon logo filling the adaptive canvas, same PNG for `icon` and `adaptiveIcon.foregroundImage`, no `monochromeImage`, judging any of it in Expo Go, forgetting `prebuild --clean` + uninstall.
- Adding a second root `SafeAreaProvider` under expo-router.

## Verify before calling it done

The full matrix with simulator/emulator commands is in `references/testing.md`. Minimum for any screen you touched:

- [ ] `node <skill>/scripts/audit-ui.mjs <app>` — no new ❌/⚠️ in the files you changed (it's heuristic: open each file:line and confirm).
- [ ] iOS: a Dynamic Island iPhone **and** iPhone SE (bottom inset 0). Android 15/16 emulator in **gesture and 3-button** navigation.
- [ ] With the software keyboard showing (iOS Simulator: I/O → Keyboard → uncheck *Connect Hardware Keyboard*), focus every input top to bottom: each stays visible with a gap, Next moves, the last one submits, Submit works on the first tap, number pads have Done.
- [ ] Text at 130%+ font scale doesn't push the button off-screen or under the keyboard.
- [ ] For icon/splash changes: `check-assets.mjs` has no ❌, previews look right, and you saw it in a release/preview build on both platforms.

Take screenshots with the iOS simulator tool or `xcrun simctl io booted screenshot`/`adb exec-out screencap -p` and look at them yourself rather than asking the user to check. Say plainly what you could not verify (e.g. "not checked on a physical Samsung launcher").

## Bundled files

- `scripts/check-assets.mjs` — icon/splash checker using Expo's real sizing maths and the launcher/splash masks; `--preview <dir>` renders what the launcher and splash will actually show. Works on any Expo app; `--file … --role …` for single files / bare RN. Exit 1 on failures.
- `scripts/audit-ui.mjs` — heuristic scan for the safe-area and keyboard anti-patterns above, plus keyboard-controller API/version mismatches. Exit 1 on failures.
- `templates/Screen.tsx` — screen container that forces an explicit `edges` decision; scroll and fixed variants; `ownSafeArea` for sheets/modals.
- `templates/FormScreen.tsx` — keyboard-aware form with sticky-on-keyboard or inline footer, persisted taps, correct inset/offset maths.
- `templates/useFocusChain.ts` — Next/Done chaining for a list of fields.
- `references/` — `safe-area.md`, `keyboard.md`, `icons-splash.md`, `new-app-setup.md`, `testing.md`.

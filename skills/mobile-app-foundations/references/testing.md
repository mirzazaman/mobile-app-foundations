# Testing safe areas, keyboard, icons & splash

Bugs in this area hide on whichever device you happen to test on. A Dynamic Island iPhone hides the 0-inset bugs. iPhone SE hides the notch bugs. An Android 14 phone without edge-to-edge hides everything Android 15+ will show. So test the **extremes** rather than "a phone".

## Device matrix

| Target | Why it matters | Must check |
|---|---|---|
| iPhone 16 Pro / 17 Pro simulator (top 62, bottom 34) | Largest top inset | Headers clear the island; nothing double-padded |
| **iPhone SE (3rd gen)** simulator (top 20, **bottom 0**, 375×667) | 0 bottom inset; shortest screen, keyboard covers ~40% | Footers keep their own padding; forms still reach the last field |
| iPad (only if `supportsTablet: true`) | Rotation, split view, floating keyboard | Landscape left/right insets; no stretched forms |
| Android 15/16 emulator, **gesture** navigation | Edge-to-edge enforced; ~24 dp bottom | Content under the status bar; bottom buttons |
| Same, **3-button** navigation | ~48 dp bottom; most "button under the nav bar" bugs | Sticky footers and FABs clear the bar; sticky footer sits ON the keyboard |
| Small Android (≈720×1280, or Display size: Largest) | Keyboard takes half the screen | Focused input and Submit both reachable |
| Display cutout emulation (tall / corner) | Larger or odd top inset | Header still clear |
| Font scale 1.3–2.0 | Text grows; fixed heights overflow | Buttons not clipped; forms scroll |
| Dark mode | Splash/icon variants, keyboard appearance | No white flash; correct splash colour |

## iOS Simulator commands

```bash
xcrun simctl list devices available | grep -E "iPhone (SE|1[6-9])"
xcrun simctl boot "iPhone SE (3rd generation)" && open -a Simulator
xcrun simctl ui booted appearance dark                     # light | dark
xcrun simctl ui booted content_size accessibility-large    # extra-small … extra-extra-extra-large, accessibility-medium … accessibility-extra-extra-extra-large
xcrun simctl io booted screenshot /tmp/shot-ios.png
```
- **Software keyboard.** With a hardware keyboard connected, iOS hides the software keyboard, so a keyboard bug looks fixed. Turn it off with Simulator → I/O → Keyboard → uncheck *Connect Hardware Keyboard* (⇧⌘K), or press ⌘K to toggle the software keyboard.
- **Rotate:** ⌘← / ⌘→.
- **Driving the simulator yourself:** with the iOS simulator tool available, take screenshots and tap inputs, then look at the result instead of asking the user.

## Android emulator commands

```bash
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton   # 3-button nav
adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.gestural      # gesture nav
adb shell cmd overlay enable-exclusive --category com.android.internal.display.cutout.emulation.tall # cutout (also .corner, .double)
adb shell settings put system font_scale 1.3        # back to 1.0 afterwards
adb shell wm density 560                             # larger "display size"; `adb shell wm density reset`
adb shell cmd uimode night yes                       # dark mode; `no` to revert
adb exec-out screencap -p > /tmp/shot-android.png
```
- **Equivalent UI routes:**
  - Navigation mode: Settings → System → Gestures/Navigation mode.
  - Cutout: Developer options → Display cutout.
- **On-screen keyboard:** if a physical keyboard is attached, Android may suppress the soft keyboard. Settings → System → Keyboard → Physical keyboard → "Use on-screen keyboard" on.
- **Splash check:** cold-start from the **launcher icon**. On Android 12/12L, a launch from adb or Android Studio doesn't show the splash icon. Run `adb shell am force-stop <package>` first.

## Per-screen checklist

**Safe area**
- [ ] Top: the header or the first content clears the status bar/island on iPhone Pro, and doesn't have a double gap.
- [ ] Bottom: the last list item and any bottom button clear the home indicator (iPhone) and the 3-button bar (Android). They still have padding on iPhone SE.
- [ ] Tab screens: no gap between content and tab bar; no content hidden behind it.
- [ ] Sheets and modals: correct top on iOS (no full-window inset), and correct top on Android (status bar cleared).
- [ ] Landscape, if allowed: the notch side has padding.

**Keyboard**
- [ ] Focus each input top to bottom: each one is fully visible with a gap; the last one too.
- [ ] Next moves focus; the last return key submits; number pads have Done.
- [ ] Submit, tapped once while the keyboard is open, submits.
- [ ] Sticky footer sits directly on the keyboard, with no inset-sized gap, in both gesture and 3-button navigation.
- [ ] A growing multiline field and a newly shown validation message keep the field visible.
- [ ] Dismissing the keyboard returns the layout cleanly (no stuck padding).
- [ ] Same at 130% font scale and on iPhone SE.

**Icons & splash** (release/preview build, old app uninstalled)
- [ ] `check-assets.mjs` shows no ❌, and you've looked at the previews.
- [ ] Android icon on a circle mask and with themed icons on.
- [ ] iOS icon in light, dark and tinted.
- [ ] Splash on both platforms in light and dark: same apparent size, not cropped, no flash between the splash and the first screen.

## Reporting

Say what you verified and on which targets, for example: "checked iPhone 16 Pro + SE simulators, Pixel 8 API 36 emulator in 3-button and gesture navigation". Say what you couldn't verify, such as a physical Samsung launcher or iOS tinted icons, rather than implying full coverage.

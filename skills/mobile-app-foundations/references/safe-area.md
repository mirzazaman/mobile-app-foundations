# Safe areas — reference

Verified 2026-10-15 for Expo SDK 54/55, RN 0.81–0.83, react-native-safe-area-context 5.6–5.10, React Navigation 7 / expo-router 6 & 55.

## Contents
1. The model: edges and owners
2. Ownership table
3. Recipes (headers, lists, footers, FABs, modals, sheets, tabs, landscape)
4. Android edge-to-edge
5. API notes (safe-area-context)
6. Reference inset values (for sanity checks only — never hard-code)

---

## 1. The model

A phone screen has four edges that system UI can cover: status bar / notch / Dynamic Island (top), home indicator / gesture bar / 3-button bar (bottom), and display cutouts plus the notch side in landscape (left/right). The **inset** of an edge is how much of it is covered.

Each edge needs exactly **one owner** that pads it:

- Too few owners → content under the status bar, the notch, or Android's navigation bar. This often looks fine on the device you test on: iPhone SE has a 0 bottom inset, and a pre-Android-15 device without edge-to-edge doesn't draw under the bars.
- Too many owners → visible double gaps, e.g. a header plus a `SafeAreaView` top, or a tab bar plus `insets.bottom`.

Decide the owners when you create the screen, and write the decision in code as the `edges` prop.

## 2. Ownership table

| Situation | Top owner | Bottom owner | Notes |
|---|---|---|---|
| Stack screen, header shown, not in tabs | header | **screen** | `edges={['bottom']}` |
| Stack screen, `headerShown: false` | **screen** | **screen** | `edges={['top','bottom']}` |
| `headerTransparent: true` | **screen**, using `useHeaderHeight()` instead of `insets.top` | screen/tab bar | Content starts under the header; React Navigation won't offset it. |
| Screen in a JS bottom-tab navigator, header shown | header | tab bar | `edges={[]}`. The tab bar already adds `insets.bottom`. |
| Tab screen, no header | **screen** | tab bar | `edges={['top']}` |
| Custom `tabBar` component | — | **your tab bar component** | Pad it with `insets.bottom`. The screens must not pad bottom. |
| expo-router **NativeTabs** SDK 55+ | screen | handled | iOS: the first ScrollView gets automatic content insets. Android: content is wrapped in a bottom-edge SafeAreaView. Opt out with `disableAutomaticContentInsets`. FlatList has limitations; check on device. |
| expo-router **NativeTabs** SDK 54 (expo-router 6) | screen | **verify on device** | 6.0.x lacks the SDK 55 default inset handling. |
| iOS native-stack `presentation: 'modal' / 'formSheet' / 'pageSheet'` | none | **screen** | The sheet starts below the status bar. The root provider's `useSafeAreaInsets()` still reports the window top (59/62 pt), so use `Screen ownSafeArea` (a nested `SafeAreaProvider`) or the native `<SafeAreaView edges>`. |
| Same route on Android | **screen** (if `headerShown: false`) | **screen** | On Android, `modal` is a full-screen push under edge-to-edge, so it needs both insets. |
| `presentation: 'fullScreenModal'` / `'transparentModal'` | screen | screen | Full screen on both platforms. |
| React Native `<Modal>` content | **screen** | **screen** | Under edge-to-edge the Modal always draws under the system bars on Android. The hook returns the *outer* window's insets. Use a nested `SafeAreaProvider` (`Screen ownSafeArea`) or the native `SafeAreaView`. |
| @gorhom/bottom-sheet content | — | **sheet content** | Pad the content's bottom with `insets.bottom`, and pass `topInset={insets.top}` so a full-height sheet stops below the status bar. |
| iOS large-title header (`headerLargeTitleEnabled`) or `headerSearchBarOptions` | UIKit | UIKit | These need `contentInsetAdjustmentBehavior="automatic"` on the ScrollView/FlatList. UIKit then insets the content itself, so adding safe-area padding on the same edges doubles it. |

When unsure, take screenshots on a Dynamic Island iPhone and an Android emulator with 3-button navigation, and look at the top and bottom 100 px.

## 3. Recipes

### Coloured header area under the status bar (both platforms)
Under Android edge-to-edge the status bar is transparent and its colour can't be set. Paint the area yourself by putting the header background behind the inset:
```tsx
const insets = useSafeAreaInsets();
<View style={{ backgroundColor: brand, paddingTop: insets.top }}>
  <HeaderContent />
</View>
<StatusBar style="light" />   // expo-status-bar: icon colour only
```
Don't use `StatusBar backgroundColor`/`translucent`. They do nothing under edge-to-edge, and RN 0.87 removed them.

### Lists and scroll views
Put the bottom inset inside the content, so the list scrolls under the home indicator but the last row can be scrolled above it:
```tsx
<FlatList contentContainerStyle={{ paddingBottom: insets.bottom + 16 }} keyboardShouldPersistTaps="handled" … />
```
Padding the FlatList container instead leaves a dead band that content never enters.

### Fixed bottom button (no keyboard involved)
```tsx
<SafeAreaView edges={{ bottom: 'maximum' }} style={{ paddingBottom: 16, paddingHorizontal: 16 }}>
  <PrimaryButton … />
</SafeAreaView>
```
`'maximum'` gives max(inset, 16): 16 on iPhone SE, 34 on Face ID iPhones, 48 on Android with 3-button navigation. The hook version is `paddingBottom: Math.max(insets.bottom, 16)`. If the screen has inputs, use the `FormScreen` template instead (see keyboard.md).

### Floating action button / absolutely positioned element
Absolute children ignore their parent's padding. Add the inset yourself:
```tsx
<Fab style={{ position: 'absolute', right: 16 + insets.right, bottom: 16 + insets.bottom /* or + tabBarHeight */ }} />
```
Inside tabs, use `useBottomTabBarHeight()` instead of `insets.bottom`, because the tab bar already includes the inset.

### Header-less screen with a custom top bar
```tsx
<Screen edges={['top', 'bottom']}>…</Screen>
```
The coloured top-bar recipe above also works.

### Landscape and iPad
Expo templates set `ios.supportsTablet: true`, so the app runs on iPad and in rotation. Choose one option deliberately:
- Lock it: `"orientation": "portrait"` in app.json (iPad still runs portrait).
- Support it: include `'left'`/`'right'` in `edges` for full-width content, and test landscape with the notch on each side.

### Root provider
- **expo-router:** already wraps the app in `SafeAreaProvider`. Don't add another at the root.
- **Plain React Navigation / no navigator:** add one at the root: `<SafeAreaProvider initialMetrics={initialWindowMetrics}>`.
  - `initialMetrics` avoids a first-frame jump. Skip it if the provider can remount.
  - Never place a provider inside an `Animated.View` or a `ScrollView`.

### One technique per screen
- **`useSafeAreaInsets()`** updates asynchronously. React Navigation prefers it because it doesn't jump during screen transitions, but it lags a frame on rotation.
- **`<SafeAreaView edges>`** is native and doesn't lag on rotation, but can jump during transitions.

Pick one per screen; mixing them on the same screen causes flicker. The `Screen` template uses the hook, with a nested provider where the hook would be wrong (sheets and modals).

## 4. Android edge-to-edge

- **Expo SDK 53:** on by default for new projects.
- **Expo SDK 54:** always on. `android.edgeToEdgeEnabled` is deprecated and ignored.
- **Expo SDK 55:** the option is removed.
- **Bare RN 0.81–0.83:** `android/gradle.properties` has `edgeToEdgeEnabled=false` in the template. However, Android 15 enforces edge-to-edge for targetSdk 35 (the opt-out works only on Android 15 devices), and Android 16 removes the opt-out for targetSdk 36 (the template's target). Without the flag, Android 15/16 devices are edge-to-edge and Android ≤14 devices are not. **Set `edgeToEdgeEnabled=true`** so every device behaves the same, then pad with insets.
- **What stops working:**
  - `StatusBar.setBackgroundColor` / `setTranslucent`: ignored, and RN logs "Ignored status bar change".
  - expo-status-bar `backgroundColor` / `translucent`.
  - expo-navigation-bar `setBackgroundColorAsync`, `setBorderColorAsync`, `setPositionAsync`, `setBehaviorAsync`.
- **What still works:**
  - Status-bar icon style (`style="dark"`, `"light"`).
  - `hidden`.
  - Navigation-bar `setStyle` (only with `enforceContrast: false`).
  - `setVisibilityAsync`.
- **3-button navigation** gets a translucent contrast scrim by default (`androidNavigationBar.enforceContrast`, default true). Content still draws behind it, so bottom-pinned UI needs `insets.bottom`.
- **Keyboard side effect:** `adjustResize` no longer resizes the window under edge-to-edge. See keyboard.md.
- **RN 0.86** fixed several edge-to-edge bugs: measureInWindow, KeyboardAvoidingView on Android 15+, StatusBar inside a Modal. Apps on 0.81–0.83 don't have these fixes, which is one more reason to rely on safe-area-context and keyboard-controller rather than core behaviour.

## 5. API notes (react-native-safe-area-context 5.x)

- **`SafeAreaView`** props:
  - `edges` is an array (default: all four) or an object with a mode per edge: `{ top: 'off' | 'additive' | 'maximum', … }`. `additive` = inset + your padding; `maximum` = max(inset, your padding).
  - `mode`: `'padding'` (default) or `'margin'`.
- **`useSafeAreaInsets()`** returns `{ top, right, bottom, left }` from the nearest provider. The values never include the keyboard.
- **`useSafeAreaFrame()`** returns the provider's frame and is useful instead of `Dimensions`.
- **React Native's own `SafeAreaView`** is iOS-only and has been deprecated since RN 0.81. Never use it.

## 6. Reference inset values (portrait, pt/dp)

Use these only to sanity-check a screenshot. Never put them in code.

| Device | Top | Bottom |
|---|---|---|
| iPhone 16 / 16 Plus | 59 | 34 |
| iPhone 16 Pro / Pro Max, iPhone 17 / 17 Pro | 62 | 34 |
| Notch iPhones (X–14) | ~44–50 | 34 |
| iPhone SE (home button) | 20 | **0** |
| Android status bar | ~24 (more with a cutout) | — |
| Android gesture nav | — | ~24 |
| Android 3-button nav | — | ~48 |

# New app setup — foundations first

`<skill>` below = the directory this skill was loaded from (e.g. `~/.claude/skills/mobile-app-foundations`).

Set these up before the first feature screen. Retrofitting safe areas and keyboard handling into 40 screens is the expensive path, and is where most of these bugs come from.

## Expo (managed / CNG)

1. **Create** the app and note the SDK:
   ```bash
   npx create-expo-app@latest my-app
   ```
   Check the `expo` version in package.json. Every pinned version below follows from it.

2. **Install the foundation packages**, all SDK-pinned. The template already has `react-native-safe-area-context`, `expo-splash-screen`, `expo-status-bar`, reanimated and worklets; `expo install` keeps them aligned.
   ```bash
   npx expo install react-native-keyboard-controller react-native-reanimated expo-system-ui
   ```
   Bottom sheets: `npx expo install @gorhom/bottom-sheet react-native-gesture-handler`.

3. **Brand assets from one logo:** see icons-splash.md for the full spec.
   ```bash
   node <skill>/scripts/check-assets.mjs --make path/to/logo.png --out assets/brand --bg "#HEX" --dark-bg "#HEX" --preview /tmp/brand-preview
   ```
   Merge the printed snippet into app.json. Remove the template's placeholder icons, and replace the template's Android-only splash block with top-level options.

4. **app.json decisions.** Write each one down; don't leave it to defaults:
   - `orientation`: `"portrait"`, unless you will really test landscape.
   - `ios.supportsTablet`: if `true`, the iPad is a test device. If the app isn't designed for iPad, set `false`.
   - `userInterfaceStyle`: `"light"`, or `"automatic"` plus dark variants for the splash, icon and theme.
   - `backgroundColor` (root, via expo-system-ui): equals the splash background and the first screen's background.
   - `android.softwareKeyboardLayoutMode`: leave it at the default `"resize"`.

5. **Copy the primitives** from `<skill>/templates/`:
   - `Screen.tsx` and `FormScreen.tsx` into `components/layout/`
   - `useFocusChain.ts` into `hooks/`

   Every screen uses `Screen` (or `FormScreen` if it has inputs). Ad-hoc `useSafeAreaInsets()` padding in screens is the drift these primitives exist to stop. Use the hook directly only for special elements: FABs, custom tab bars, headers that paint under the status bar.

6. **Root layout**, `app/_layout.tsx`:
   ```tsx
   import { Stack } from 'expo-router';
   import * as SplashScreen from 'expo-splash-screen';
   import { StatusBar } from 'expo-status-bar';
   import { KeyboardProvider } from 'react-native-keyboard-controller';

   SplashScreen.preventAutoHideAsync();

   export default function RootLayout() {
     const ready = useAppReady();                 // fonts, session, …
     useEffect(() => { if (ready) SplashScreen.hideAsync(); }, [ready]);
     if (!ready) return null;
     return (
       <KeyboardProvider>
         <StatusBar style="dark" />
         <Stack screenOptions={{ contentStyle: { backgroundColor: colors.background } }} />
       </KeyboardProvider>
     );
   }
   ```
   expo-router already provides `SafeAreaProvider`, so don't add another.

7. **Navigation conventions.** Decide these per route and record them in the project's CLAUDE.md:
   - Which stacks show a header. Their screens use `edges={['bottom']}`.
   - Which are headerless. Those use `edges={['top','bottom']}`.
   - Tabs: JS bottom tabs (the screens own no bottom edge), or NativeTabs (SDK 55+ handles insets; on SDK 54, verify).
   - Sheets and modals: `presentation` type, and `Screen ownSafeArea`.

8. **Gate before the first build:**
   ```bash
   node <skill>/scripts/check-assets.mjs . --preview /tmp/asset-preview
   node <skill>/scripts/audit-ui.mjs .
   ```
   Then build a dev client, run through the matrix in testing.md once with a sample form screen, and make a preview build for the icon and splash.

9. **Write a short section in the project's CLAUDE.md** so every later session follows the same rules:
   ```markdown
   ## UI foundations
   - Screens: `components/layout/Screen` (required `edges`) / `FormScreen` for any input. No raw SafeAreaView, no ad-hoc insets in screens.
   - Keyboard: react-native-keyboard-controller <version> (SDK-pinned — check before using newer APIs); KeyboardProvider in app/_layout.tsx.
   - Icons/splash: assets/brand/*, generated + checked with the mobile-app-foundations skill scripts; verify in a release build.
   - Headers: <which stacks show headers>; tabs: <JS tabs | NativeTabs>.
   ```

## Bare React Native CLI

1. Create the app:
   ```bash
   npx @react-native-community/cli@latest init MyApp
   ```
2. Edge-to-edge everywhere: set `edgeToEdgeEnabled=true` in `android/gradle.properties`. The template ships `false`, but Android 15/16 devices force edge-to-edge anyway, so only consistent-everywhere is testable.
3. Install the packages, then run `cd ios && pod install`:
   ```bash
   npm i react-native-safe-area-context react-native-keyboard-controller react-native-reanimated react-native-worklets react-native-bootsplash
   ```
   Add Reanimated's Babel plugin as its docs say for your version (for Reanimated 4: `react-native-worklets/plugin`).
4. Root:
   ```tsx
   <SafeAreaProvider initialMetrics={initialWindowMetrics}>
     <KeyboardProvider>
       <NavigationContainer>…</NavigationContainer>
     </KeyboardProvider>
   </SafeAreaProvider>
   ```
5. Splash: generate with react-native-bootsplash (`generate … --logo-width ≤134` for square marks). Hide it with `BootSplash.hide({ fade: true })` once the first screen is ready.
6. Icons:
   - Android Studio Image Asset: adaptive icon with a monochrome layer.
   - Xcode AppIcon: single 1024 opaque image.
   - Check the source PNGs with `check-assets.mjs --file … --role …`.
7. Steps 5–9 of the Expo list apply unchanged: primitives, conventions, the gate, and the CLAUDE.md section.

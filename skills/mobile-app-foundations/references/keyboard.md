# Keyboard — reference

Verified 2026-10-15 against react-native-keyboard-controller 1.18.5 (Expo SDK 54 pin), 1.20.7 (SDK 55 pin) and 1.22.7 (latest), RN 0.81–0.83, @gorhom/bottom-sheet 5.2.

## Contents
1. Setup (Expo / bare) and the version table
2. What "keyboard interactive" means for every input
3. Patterns with code: form · sticky CTA · login/OTP · chat · search · lists · bottom sheet · modal
4. Focus chaining, toolbar, number pads
5. Android specifics (edge-to-edge, softwareKeyboardLayoutMode)
6. Fallback when the library can't be added
7. Input props checklist

---

## 1. Setup

**Expo**
```bash
npx expo install react-native-keyboard-controller react-native-reanimated
```
- On SDK 54+ this also needs `react-native-worklets`, which the Expo templates already include.
- `npx expo install` installs the **SDK-pinned** version, not the latest. The SDK's own Expo Go includes that version. Any other version needs a dev build.

**Bare React Native**
```bash
npm i react-native-keyboard-controller react-native-reanimated
```
- Follow Reanimated's babel/worklets setup, then run `cd ios && pod install`.
- If `edgeToEdgeEnabled` is false in a bare app, set `KeyboardProvider`'s `statusBarTranslucent` / `navigationBarTranslucent` to match your actual system bars. Better: turn edge-to-edge on (see safe-area.md).

**Root**: render `KeyboardProvider` once, above everything that uses the library:
```tsx
// app/_layout.tsx (expo-router)
import { KeyboardProvider } from 'react-native-keyboard-controller';
export default function RootLayout() {
  return (
    <KeyboardProvider>
      <Stack />
    </KeyboardProvider>
  );
}
```
- Without the provider, the components silently do nothing; they only log "Couldn't find real values for KeyboardContext".
- On Expo SDK 54+ (always edge-to-edge), don't pass `statusBarTranslucent`, `navigationBarTranslucent` or `preserveEdgeToEdge`. They're forced to true and you only get a dev warning.

**Version table**: check `node_modules/react-native-keyboard-controller/package.json` before using an API.

| API | Min version | SDK 54 (1.18.5) | SDK 55 (1.20.7) |
|---|---|---|---|
| `KeyboardAwareScrollView` `bottomOffset`, `disableScrollOnKeyboardHide`, `enabled` | ≤1.11 | ✅ | ✅ |
| `extraKeyboardSpace` | 1.13 | ✅ | ✅ |
| `KeyboardStickyView` `offset {closed, opened}` | old | ✅ | ✅ |
| `KeyboardAvoidingView behavior="translate-with-padding"` | 1.16.5 | ✅ | ✅ |
| `KeyboardToolbar` legacy props (`doneText`, `showArrows`, `onDoneCallback`, `onNextCallback`, `onPrevCallback`, `theme`, `opacity`, `insets`, `button`, `icon`, `content`, `blur`) | old (deprecated from 1.19, still work) | ✅ | ✅ |
| `KeyboardToolbar.Prev/Next/Done/Content/Background` compound API | 1.19 | ❌ | ✅ |
| `assureFocusedInputVisible()` ref method / `KeyboardAwareScrollViewRef` type | 1.20 | ❌ | ✅ |
| `KeyboardChatScrollView`, `KeyboardToolbar.Group`, KAV `automaticOffset` | 1.21 | ❌ | ❌ |
| `KeyboardAwareScrollView mode="insets" \| "layout"` | 1.21.4 | ❌ | ❌ |
| `KeyboardEffects` | 1.22 | ❌ | ❌ |

`scripts/audit-ui.mjs` flags uses of APIs that are newer than the installed version.

## 2. "Keyboard interactive", concretely

For every input on every screen:
- Focusing it scrolls it fully into view with a gap (`bottomOffset`), including inputs at the very bottom of the form.
- Moving focus to another field while the keyboard is open scrolls again.
- A growing multiline field stays visible.
- "Next" goes to the following field, and the last field's return key submits.
- The primary button is reachable while the keyboard is open, and works on the **first** tap.
- Number pads have a way to finish (a Done key or a toolbar).
- Tapping empty space or dragging dismisses the keyboard where that's natural. Nothing dismisses it while the user is mid-form.

## 3. Patterns

### A. Form, button at the end (long forms, settings, edit profile)
```tsx
<FormScreen edges={['bottom']} footerMode="inline" footer={<Button title="Save" onPress={save} />}>
  <TextInput {...field(0)} … />
  …
</FormScreen>
```
- This is the `FormScreen` template: a `KeyboardAwareScrollView` with `bottomOffset` and `keyboardShouldPersistTaps="handled"`, and the bottom inset inside the content.
- After a validation message appears under the focused field (≥1.20), call `ref.current?.assureFocusedInputVisible()`.

### B. Primary button rides on the keyboard (login, sign-up step, OTP, amount entry, checkout)
```tsx
<FormScreen edges={['bottom']} footerMode="sticky" footer={<Button title="Continue" onPress={next} />}>
  …fields…
</FormScreen>
```
How the sticky footer works:
- **Layout:** the container pads `insets.bottom` and the footer sits above that padding. The footer is inside `KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}`.
- **Why `opened: insets.bottom`:** a positive offset moves the footer *down*. That puts the container's inset behind the keyboard, so the button sits directly on the keyboard instead of an inset higher.
- **Focus target:** `KeyboardAwareScrollView bottomOffset = footerHeight + gap`. This keeps the focused field above the floating footer, not just above the keyboard. Without it, the last field ends up hidden behind the button.
- **Taps:** `keyboardShouldPersistTaps="handled"`. The footer is outside the ScrollView, so its taps work anyway. The setting matters for buttons inside the scroll content.

### C. Single centred input (OTP / PIN / search-first onboarding)
```tsx
<KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled"
  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, paddingBottom: insets.bottom + 24 }}>
```
- `flexGrow: 1` + `justifyContent: 'center'` keeps the input centred while there's room.
- The view still scrolls when the keyboard takes the space.

### D. Chat / composer
Pick by installed version:
- **≥1.21: `KeyboardChatScrollView`.** Set the `inverted` prop when the list is inverted. Choose a `keyboardLiftBehavior`:
  - `'always'` (default)
  - `'whenAtEnd'`: only lift when scrolled to the latest message
  - `'persistent'`
  - `'never'`
- **≥1.16.5 (SDK 54/55): `KeyboardAvoidingView behavior="translate-with-padding"`.** It wraps the inverted FlatList plus the composer, and it's the best-performing behaviour for chat. Set `keyboardVerticalOffset` to the header height (`useHeaderHeight()`) when the header is inside the same screen.

Either way:
- Give the composer the bottom inset only while the keyboard is closed, using `KeyboardStickyView` with `offset={{ closed: 0, opened: insets.bottom }}`. That keeps the composer from floating an inset above the keyboard.
- Set `keyboardShouldPersistTaps="handled"` on the list, so tapping a message's link or button works.
- Use `keyboardDismissMode="interactive"` (iOS) if you want drag-to-dismiss.

### E. Search screen (input in the header, results below)
- No keyboard avoider is needed for the input itself.
- The results list needs:
  - `keyboardShouldPersistTaps="handled"`, so the first tap opens the result.
  - `keyboardDismissMode="on-drag"`.
  - `contentContainerStyle={{ paddingBottom: insets.bottom }}`.

### F. Inputs inside a FlatList / SectionList (editable rows, line items)
`KeyboardAwareScrollView` must not wrap a virtualized list. Make the list use it as its scroll component:
```tsx
<FlatList
  data={rows}
  renderItem={…}
  keyboardShouldPersistTaps="handled"
  renderScrollComponent={(props) => <KeyboardAwareScrollView {...props} bottomOffset={24} />}
/>
```
Rows that aren't rendered (virtualized) can't be focused with "Next". For short editable lists, a `.map()` inside `FormScreen` is simpler.

### G. Bottom sheet (@gorhom/bottom-sheet v5)
```tsx
<BottomSheet keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" enableBlurKeyboardOnGesture>
  <BottomSheetView style={{ paddingBottom: insets.bottom }}>
    <BottomSheetTextInput … />
  </BottomSheetView>
</BottomSheet>
```
- Use `BottomSheetTextInput`, not a plain `TextInput`. Only it is wired into the sheet's keyboard handling.
- `keyboardBehavior="fillParent"` / `"extend"` suit tall forms.
- For many fields, use a full-screen route with `FormScreen` instead of a sheet.

### H. React Native `<Modal>` with inputs
A Modal is a separate native window, and keyboard behaviour inside it differs on Android. Prefer a navigation route (`presentation: 'modal'` / `'formSheet'`) with `FormScreen` for any form. If it has to be a `<Modal>`, test it on an Android device or emulator with the keyboard open.

## 4. Focus chaining, toolbar, number pads

**Chain** (`templates/useFocusChain.ts`):
- Every non-last field: `returnKeyType="next"`, `submitBehavior="submit"` (keeps the keyboard up, no flicker) and `onSubmitEditing={() => next.current?.focus()}`.
- The last field: `returnKeyType="done"` / `"go"` / `"send"` and `onSubmitEditing={submit}`.
- `blurOnSubmit` is deprecated (RN 0.76 types); use `submitBehavior` instead.
- Custom input components must forward `ref` and these props.

**KeyboardToolbar** (Prev / Next / Done above the keyboard):
- Use it for forms with multiline fields, pickers mixed with inputs, or several number pads.
- Prev/Next follow the **view hierarchy order** of the inputs.
- Render it once per screen, as a sibling after the scroll view.
- Add its height to `bottomOffset` so the focused field clears it, then verify on a device.

```tsx
// any version (SDK 54+)
<KeyboardToolbar doneText="Done" />
// ≥1.19 (SDK 55+), compound API
<KeyboardToolbar>
  <KeyboardToolbar.Prev />
  <KeyboardToolbar.Next />
  <KeyboardToolbar.Done text="Done" />
</KeyboardToolbar>
```

**iOS number pads** (`number-pad`, `phone-pad`, `decimal-pad`, `ascii-capable-number-pad`) have no return key.
- **Built-in fix:** set a `returnKeyType` such as `"done"` or `"next"`, or `inputAccessoryViewButtonLabel`. React Native then adds a bar with that button, and the iOS bar calls `onSubmitEditing`. The RN docs say `onSubmitEditing` isn't called for `phone-pad` without it.
- **Or:** use a `KeyboardToolbar` on the screen.
- **Not both:** you'd get two bars.
- **`InputAccessoryView`:** iOS-only, and doesn't work with multiline or a bottom tab bar, so prefer the two options above.

## 5. Android specifics

- **`android.softwareKeyboardLayoutMode`** (app.json): leave it at `"resize"`, the default. `"pan"` slides the whole window up, so the header leaves the screen and absolute footers land in the wrong place.
- **Edge-to-edge:** with edge-to-edge on (always on in Expo 54+, and on Android 15+ devices for bare RN), `adjustResize` behaves like `adjustNothing`, so the window is **not resized**. Two consequences:
  - Code that relied on the window shrinking does nothing: RN `KeyboardAvoidingView` with `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, or a footer pinned with `position: 'absolute', bottom: 0`.
  - keyboard-controller reads the real keyboard height from window insets, which is why it works.
- **Sticky footer check:** with the `offset.opened = insets.bottom` rule the footer should sit directly on the keyboard. Confirm that on an emulator in **3-button** navigation (bottom inset ≈48 dp), where any inset mistake shows up as a visible band.

## 6. Fallback when the library can't be added

React Native's own `KeyboardAvoidingView`:
- Set a behaviour on **both** platforms: `behavior="padding"` (with RN ≥0.86 it works on Android 15+; older versions need testing).
- Set `keyboardVerticalOffset={useHeaderHeight()}` when a navigation header sits above the view. A guessed number like 64 or 100 is wrong on other devices.
- Put a ScrollView inside it with `keyboardShouldPersistTaps="handled"`.
- Scrolling to the focused input isn't automatic, so a field low in a long form can still be hidden. That's the main reason to use keyboard-controller.

## 7. Input props checklist

Correct keyboards cut friction and autofill errors:

| Field | Props |
|---|---|
| Email | `keyboardType="email-address"` `autoCapitalize="none"` `autoComplete="email"` `textContentType="emailAddress"` |
| Password | `secureTextEntry` `autoComplete="current-password"` / `"new-password"` `textContentType="password"` / `"newPassword"` |
| Phone | `keyboardType="phone-pad"` `autoComplete="tel"` `textContentType="telephoneNumber"` + `returnKeyType` |
| One-time code | `keyboardType="number-pad"` `autoComplete="one-time-code"` (Android: `"sms-otp"`) `textContentType="oneTimeCode"` |
| Money / decimal | `keyboardType="decimal-pad"` + `returnKeyType="done"` |
| Name | `autoCapitalize="words"` `autoComplete="name"` `textContentType="name"` |
| Search | `returnKeyType="search"` `autoCorrect={false}` `clearButtonMode="while-editing"` (iOS) |

**Testing on the iOS Simulator:** a connected hardware keyboard hides the software keyboard, and the screen then looks fine when it isn't. Turn it off with I/O → Keyboard → uncheck *Connect Hardware Keyboard* (⇧⌘K), or toggle the software keyboard with ⌘K.

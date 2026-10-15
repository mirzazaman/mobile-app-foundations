# mobile-app-foundations

A Claude skill that stops the bugs that keep coming back in React Native / Expo apps:

- **Safe areas**
  - Content under the notch, Dynamic Island or status bar.
  - Buttons under the Android gesture bar or 3-button bar.
  - Double padding where two things inset the same edge.
- **Keyboard**
  - The focused input or the Submit button hidden by the keyboard.
  - Forms that don't scroll to the next field.
  - The first tap on Submit only closing the keyboard.
  - Number pads with no Done key.
- **App icons and splash screens**
  - Assets that look right in Expo Go but wrong after `expo prebuild`.
  - Logos oversized or cropped on circle and squircle launchers.
  - A splash logo that is a different size on iOS and Android.

When Claude works on a React Native or Expo app, the skill loads rules, drop-in components and two zero-dependency Node scripts. The scripts check a project against what the platforms actually do.

## What's inside

```
skills/mobile-app-foundations/
├── SKILL.md                    core rules, task routing, common mistakes, verify checklist
├── references/
│   ├── safe-area.md            edge-ownership table, modals/sheets/tabs, Android edge-to-edge
│   ├── keyboard.md             patterns: form, sticky CTA, chat, lists, bottom sheet; version table
│   ├── icons-splash.md         why sizes differ, exact geometry, Expo + bare RN config
│   ├── new-app-setup.md        foundations to set up before the first screen
│   └── testing.md              device matrix + simulator/emulator commands
├── templates/
│   ├── Screen.tsx              screen container with a required `edges` decision
│   ├── FormScreen.tsx          keyboard-aware form, footer sticky-on-keyboard or inline
│   └── useFocusChain.ts        Next / Done chaining
└── scripts/
    ├── check-assets.mjs        icon/splash checker, preview renderer, asset generator
    └── audit-ui.mjs            scans code for safe-area and keyboard anti-patterns
```

## Install

Pick one. Installing the same skill twice gives Claude duplicate copies.

### Claude Code: plugin

```
/plugin marketplace add mirzazaman/mobile-app-foundations
/plugin install mobile-app-foundations@mobile-app-foundations
```

The repository is private, so your git credentials must have access to it (for example via `gh auth login`).

### Claude Code: personal skill folder

```bash
git clone https://github.com/mirzazaman/mobile-app-foundations.git /tmp/mobile-app-foundations
cp -R /tmp/mobile-app-foundations/skills/mobile-app-foundations ~/.claude/skills/
```

New Claude Code sessions pick it up automatically.

### Claude apps (claude.ai, desktop chat)

1. Download `mobile-app-foundations.skill` from the latest release.
2. Add it to your account from Claude's Skills settings, or open it in Claude and click **Save skill**.

### Optional: make Claude reach for it every time

Add this to `~/.claude/CLAUDE.md`:

```markdown
For any React Native or Expo work (screens, forms, safe areas, keyboard, app icons, splash screens, prebuild),
load the `mobile-app-foundations` skill first and follow it.
```

## Use

You don't need to call the skill by name. "Add a login screen", "the submit button hides behind the keyboard on Android" or "our splash logo is cut off" are enough. The scripts also work on their own:

```bash
# icon + splash check for an Expo app, with rendered previews of launcher masks and the splash circle
node skills/mobile-app-foundations/scripts/check-assets.mjs path/to/app --preview /tmp/asset-preview

# generate a correct icon/splash set from one transparent logo, and print the app.json snippet
node skills/mobile-app-foundations/scripts/check-assets.mjs --make logo.png --out assets/brand --bg "#F7F7F3" --dark-bg "#121212"

# scan a codebase for safe-area and keyboard anti-patterns (heuristic; reports file:line)
node skills/mobile-app-foundations/scripts/audit-ui.mjs path/to/app
```

Both scripts exit with code 1 when a check fails, so they can gate CI.

## Scope and accuracy

- Verified in October 2026 against:
  - Expo SDK 54 and 55, and React Native 0.81–0.83.
  - react-native-keyboard-controller 1.18.5 and 1.20.7 (the versions pinned by Expo SDK 54 and 55), and 1.22.
  - react-native-safe-area-context 5.x.
- The splash maths comes from Expo's own `@expo/prebuild-config` source. `check-assets.mjs` re-reads it from the installed package and warns if it changes.
- On newer stacks, re-check anything version-specific; the version table in `references/keyboard.md` is the place to start.
- `audit-ui.mjs` is a pattern scan, not a compiler. Open each reported file:line and confirm before changing it.

## License

MIT, © 2026 Muhammad Zaman

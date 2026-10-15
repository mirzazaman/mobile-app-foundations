#!/usr/bin/env node
// audit-ui.mjs — heuristic scan of a React Native / Expo codebase for the safe-area and keyboard
// mistakes that keep coming back (wrong SafeAreaView, hard-coded notch padding, inputs hidden by
// the keyboard, first tap eaten while the keyboard is open, no "next" chain, number pads with no
// Done key, keyboard-controller APIs newer than the installed version, …).
//
//   node audit-ui.mjs [projectDir]        (default: cwd)
//
// It is a pattern scan, not a compiler: every finding names file:line so you can open it and
// confirm. Exit code 1 when a ❌ finding exists.

import fs from 'node:fs';
import path from 'node:path';

const dir = path.resolve(process.argv[2] ?? '.');
const SKIP = new Set(['node_modules', 'ios', 'android', '.expo', '.git', 'dist', 'build', 'web-build', 'coverage', '.next', 'Pods', 'vendor', '__generated__']);
const EXT = /\.(tsx|jsx|ts|js)$/;
const ICON = { fail: '❌', warn: '⚠️ ', info: 'ℹ️ ' };

if (!fs.existsSync(path.join(dir, 'package.json'))) {
  console.error(`audit-ui: ${dir} has no package.json`);
  process.exit(2);
}
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const deps = { ...pkg.dependencies, ...pkg.devDependencies };
const installedVersion = (name) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'node_modules', name, 'package.json'), 'utf8')).version;
  } catch {
    return deps[name]?.replace(/^[^\d]*/, '') ?? null;
  }
};
const semver = (v) => (v ?? '0.0.0').split(/[.-]/).slice(0, 3).map((n) => parseInt(n, 10) || 0);
const gte = (v, want) => {
  const a = semver(v), b = semver(want);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return true;
};

const kcVersion = deps['react-native-keyboard-controller'] ? installedVersion('react-native-keyboard-controller') : null;
const expoVersion = deps.expo ? installedVersion('expo') : null;
const hasRouter = !!deps['expo-router'];
const hasNavigation = Object.keys(deps).some((d) => d.startsWith('@react-navigation/'));

// ── collect files ──────────────────────────────────────────────────────────────────────────────
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (SKIP.has(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (EXT.test(e.name) && !/\.(test|spec|d)\.[jt]sx?$/.test(e.name)) files.push(p);
  }
})(dir);

const findings = []; // [level, rel, line, rule, msg]
const add = (level, file, line, rule, msg) => findings.push([level, file ? path.relative(dir, file) : '(project)', line, rule, msg]);
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length;

// Opening JSX tag text starting at idx (stops at the first ">" outside braces).
function tagAt(src, idx) {
  let depth = 0;
  for (let i = idx; i < Math.min(src.length, idx + 4000); i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') depth--;
    else if (c === '>' && depth === 0 && src[i - 1] !== '=') return src.slice(idx, i + 1);
  }
  return src.slice(idx, idx + 400);
}
const importsFrom = (src, name, mod) => new RegExp(`import\\s*(type\\s*)?\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from\\s*['"]${mod.replace(/[/\\-]/g, '\\$&')}['"]`).test(src);

const INPUT_TAG = /<(TextInput|BottomSheetTextInput|[A-Z]\w*Input|[A-Z]\w*TextField)\b/g;
const SCROLL_TAG = /<(ScrollView|FlatList|SectionList|FlashList|KeyboardAwareScrollView|KeyboardChatScrollView|BottomSheetScrollView|BottomSheetFlatList|Animated\.ScrollView|Animated\.FlatList)\b/g;
// Library components, plus any project-local keyboard hook/wrapper (useKeyboardPad, KeyboardAwareForm, imports from a */keyboard* path).
const KB_COMPONENT = /\b(KeyboardAware\w*|KeyboardAvoidingView|KeyboardStickyView|KeyboardChatScrollView|BottomSheetTextInput|BottomSheetScrollView|useKeyboard\w*|useReanimatedKeyboardAnimation)\b|from\s*['"][^'"]*keyboard[^'"]*['"]/i;

let providerSeen = false;
let safeAreaProviderSeen = false;
let anyInputInScroll = false;

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  if (/\bKeyboardProvider\b/.test(src) && /<KeyboardProvider\b/.test(src)) providerSeen = true;
  if (/<SafeAreaProvider\b/.test(src)) safeAreaProviderSeen = true;
  let m;

  // ── Safe area ──
  if (importsFrom(src, 'SafeAreaView', 'react-native')) {
    const i = src.search(/\bSafeAreaView\b[^;]*from\s*['"]react-native['"]/);
    add('fail', file, lineOf(src, Math.max(0, i)), 'SA1', 'SafeAreaView from "react-native" is iOS-only and deprecated — it does nothing on Android (status bar / gesture bar overlap). Use SafeAreaView from "react-native-safe-area-context" with an explicit edges prop');
  }
  for (const re of [/StatusBar\.currentHeight/g]) while ((m = re.exec(src))) add('warn', file, lineOf(src, m.index), 'SA2', 'StatusBar.currentHeight used for layout — wrong under edge-to-edge and ignores cutouts/nav bar. Use useSafeAreaInsets().top or SafeAreaView edges');
  const legacyRe = /(react-native-iphone-x-helper|react-native-status-bar-height|react-native-safe-area-view|\bisIphoneX\b|\bgetStatusBarHeight\b|\bgetBottomSpace\b)/g;
  while ((m = legacyRe.exec(src))) add('warn', file, lineOf(src, m.index), 'SA3', `legacy device-model inset helper "${m[1]}" — breaks on new devices. Use react-native-safe-area-context insets`);
  const magicRe = /(Platform\.OS\s*===?\s*['"]ios['"]\s*\?\s*(20|24|30|34|40|44|47|48|50|54|59|60|62)\b|ios:\s*(34|44|47|50|54|59|62)\b)/g;
  while ((m = magicRe.exec(src))) add('warn', file, lineOf(src, m.index), 'SA4', `hard-coded notch/home-indicator number ("${m[0].trim()}") — differs per device (SE: 20/0, notch: 47/34, Dynamic Island: 59-62/34). Use insets`);
  const savRe = /<SafeAreaView\b/g;
  if (importsFrom(src, 'SafeAreaView', 'react-native-safe-area-context')) {
    while ((m = savRe.exec(src))) {
      const tag = tagAt(src, m.index);
      if (!/\bedges\s*=/.test(tag)) add('info', file, lineOf(src, m.index), 'SA5', 'SafeAreaView without "edges" pads ALL four edges. Under a navigation header (top) or tab bar (bottom) that double-pads — state the edges this screen owns, e.g. edges={["bottom"]}');
    }
  }

  // ── Keyboard ──
  const inputs = [...src.matchAll(INPUT_TAG)];
  const hasInput = inputs.length > 0;
  if (importsFrom(src, 'KeyboardAvoidingView', 'react-native')) {
    const i = src.search(/<KeyboardAvoidingView\b/);
    const iosOnly = /behavior\s*=\s*\{\s*Platform\.OS\s*===?\s*['"]ios['"]\s*\?\s*['"]\w+['"]\s*:\s*(undefined|null|['"]{2})\s*\}/.test(src);
    add(iosOnly && expoVersion && gte(expoVersion, '54.0.0') ? 'fail' : 'warn', file, lineOf(src, Math.max(0, i)), 'KB1',
      iosOnly
        ? 'KeyboardAvoidingView with behavior only on iOS — that relied on Android resizing the window, which edge-to-edge (always on from Expo SDK 54 / Android 15+) no longer does, so Android inputs end up under the keyboard. Use react-native-keyboard-controller (KeyboardAwareScrollView / KeyboardAvoidingView) or set a behavior on Android too'
        : 'React Native\'s own KeyboardAvoidingView — fragile with headers (needs keyboardVerticalOffset = header height) and with Android edge-to-edge. Prefer react-native-keyboard-controller components');
  }
  if (hasInput) {
    let scrolls = 0;
    SCROLL_TAG.lastIndex = 0;
    while ((m = SCROLL_TAG.exec(src))) {
      scrolls++;
      const tag = tagAt(src, m.index);
      if (!/keyboardShouldPersistTaps\s*=/.test(tag))
        add('warn', file, lineOf(src, m.index), 'KB2', `<${m[1]}> in a file with text inputs has no keyboardShouldPersistTaps — while the keyboard is open the first tap on a button (Submit!) only dismisses the keyboard. Add keyboardShouldPersistTaps="handled" (on every scroll ancestor of the inputs)`);
      else if (/keyboardShouldPersistTaps\s*=\s*["{']*always/.test(tag))
        add('info', file, lineOf(src, m.index), 'KB7', 'keyboardShouldPersistTaps="always" — taps on empty space then never dismiss the keyboard; "handled" is usually what you want');
    }
    if (scrolls) anyInputInScroll = true;
    if (/<ScrollView\b/.test(src) && !KB_COMPONENT.test(src))
      add('warn', file, lineOf(src, inputs[0].index), 'KB3', 'text inputs inside a plain ScrollView with no keyboard handling — a focused input low on the screen is hidden behind the keyboard. Use KeyboardAwareScrollView (react-native-keyboard-controller) with bottomOffset');
    else if (!scrolls && !KB_COMPONENT.test(src) && inputs.length >= 2)
      add('info', file, lineOf(src, inputs[0].index), 'KB3b', 'several inputs but no scroll container or keyboard handling — on small phones / large font sizes the lower inputs and the submit button end up under the keyboard');
    const multiInputs = inputs.filter((x) => x[1] !== 'BottomSheetTextInput').length;
    if (multiInputs >= 2 && !(/returnKeyType\s*=/.test(src) && /onSubmitEditing\s*=/.test(src)))
      add('warn', file, lineOf(src, inputs[0].index), 'KB5', `${multiInputs} inputs but no returnKeyType + onSubmitEditing chain — "next" should move to the following field and the last one should submit (returnKeyType="next"/"done", submitBehavior="submit" on the non-last ones)`);
    const numRe = /keyboardType\s*=\s*\{?\s*['"](number-pad|phone-pad|decimal-pad|numeric|ascii-capable-number-pad)['"]/g;
    while ((m = numRe.exec(src))) {
      const tag = tagAt(src, src.lastIndexOf('<', m.index));
      if (!/returnKeyType\s*=|inputAccessoryViewButtonLabel\s*=|inputAccessoryViewID\s*=/.test(tag) && !/KeyboardToolbar\b/.test(src))
        add('warn', file, lineOf(src, m.index), 'KB6', `keyboardType "${m[1]}" has no return key on iOS — the user cannot press Done/Next. Add returnKeyType="done" (RN then shows a Done bar on iOS) or a KeyboardToolbar`);
    }
  }
  const blurRe = /\bblurOnSubmit\s*=/g;
  while ((m = blurRe.exec(src))) add('info', file, lineOf(src, m.index), 'KB4', 'blurOnSubmit is deprecated (RN 0.76+) — use submitBehavior="submit" | "blurAndSubmit" | "newline"');
  if (/<KeyboardAvoidingView\b/.test(src) && /<KeyboardAwareScrollView\b/.test(src))
    add('warn', file, lineOf(src, src.search(/<KeyboardAvoidingView\b/)), 'KB8', 'KeyboardAvoidingView and KeyboardAwareScrollView in the same screen — two mechanisms fighting over the same keyboard height (double gap / jump). Use one');
  if (/<KeyboardStickyView\b/.test(src)) {
    const i = src.search(/<KeyboardStickyView\b/);
    if (!/offset\s*=/.test(tagAt(src, i)) && /insets\.bottom|\bbottom\b\s*[,}]|edges=\{[^}]*bottom/.test(src))
      add('info', file, lineOf(src, i), 'KB9', 'KeyboardStickyView without offset while the footer pads the bottom inset — when the keyboard opens that inset becomes an extra gap above it. Use offset={{ closed: 0, opened: insets.bottom }} (positive moves down)');
  }
  // keyboard-controller APIs newer than the installed version
  if (kcVersion) {
    const gates = [
      [/KeyboardToolbar\.(Prev|Next|Done|Content|Background)\b/, '1.19.0', 'KeyboardToolbar compound API'],
      [/KeyboardToolbar\.Group\b/, '1.21.0', 'KeyboardToolbar.Group'],
      [/\bKeyboardChatScrollView\b/, '1.21.0', 'KeyboardChatScrollView'],
      [/\bautomaticOffset\b/, '1.21.0', 'KeyboardAvoidingView automaticOffset'],
      [/<KeyboardAwareScrollView\b[^>]*\bmode\s*=/, '1.21.4', 'KeyboardAwareScrollView mode'],
      [/\bKeyboardEffects\b/, '1.22.0', 'KeyboardEffects'],
      [/\bassureFocusedInputVisible\b/, '1.20.0', 'assureFocusedInputVisible()'],
      [/\bKeyboardAwareScrollViewRef\b/, '1.20.0', 'the KeyboardAwareScrollViewRef type'],
      [/['"]translate-with-padding['"]/, '1.16.5', 'behavior="translate-with-padding"'],
      [/\bextraKeyboardSpace\b/, '1.13.0', 'extraKeyboardSpace'],
    ];
    for (const [re, min, what] of gates) {
      const i = src.search(re);
      if (i >= 0 && !gte(kcVersion, min)) add('fail', file, lineOf(src, i), 'KB10', `${what} needs react-native-keyboard-controller ≥ ${min}; installed ${kcVersion} (Expo pins it per SDK — check before using newer APIs)`);
    }
  }
  if (/<KeyboardProvider\b[^>]*\b(statusBarTranslucent|navigationBarTranslucent)\b/.test(src) && expoVersion && gte(expoVersion, '54.0.0'))
    add('info', file, lineOf(src, src.search(/<KeyboardProvider\b/)), 'KB11', 'statusBarTranslucent/navigationBarTranslucent on KeyboardProvider are ignored under edge-to-edge (always on from Expo SDK 54) — drop them');
}

// ── project-level ──────────────────────────────────────────────────────────────────────────────
if (kcVersion && !providerSeen) add('fail', null, 0, 'P1', 'react-native-keyboard-controller is installed but <KeyboardProvider> is never rendered — its components then do nothing. Wrap the app root in <KeyboardProvider>');
if (!kcVersion && anyInputInScroll) add('warn', null, 0, 'P2', `react-native-keyboard-controller is not installed. It is the reliable cross-platform fix for inputs/buttons under the keyboard (needs react-native-reanimated). Install with ${deps.expo ? '"npx expo install react-native-keyboard-controller"' : '"npm i react-native-keyboard-controller"'} and rebuild`);
if (deps['react-native-keyboard-aware-scroll-view']) add('warn', null, 0, 'P3', 'react-native-keyboard-aware-scroll-view is unmaintained and miscalculates under Android edge-to-edge — migrate to react-native-keyboard-controller\'s KeyboardAwareScrollView');
if (deps['react-native-safe-area-context'] && !safeAreaProviderSeen && !hasRouter && !hasNavigation) add('fail', null, 0, 'P4', 'react-native-safe-area-context is used but no <SafeAreaProvider> wraps the app — insets read as 0');
try {
  const appJson = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  const exp = appJson.expo ?? appJson;
  if (exp.android?.softwareKeyboardLayoutMode === 'pan') add('warn', null, 0, 'P5', 'android.softwareKeyboardLayoutMode "pan" slides the WHOLE window up (header goes off-screen, sticky footers misplace). Use "resize" (default) with keyboard-controller');
} catch {}
try {
  const gp = fs.readFileSync(path.join(dir, 'android/gradle.properties'), 'utf8');
  const e2e = /^\s*edgeToEdgeEnabled\s*=\s*(\w+)/m.exec(gp)?.[1];
  if (!deps.expo && e2e !== 'true') add('info', null, 0, 'P6', `android/gradle.properties edgeToEdgeEnabled=${e2e ?? '(unset)'} — Android 15+ devices still force edge-to-edge for targetSdk 35+, and the opt-out is gone at targetSdk 36. Turn it on deliberately and pad with insets, then test 3-button and gesture navigation`);
} catch {}

// ── report ─────────────────────────────────────────────────────────────────────────────────────
const order = { fail: 0, warn: 1, info: 2 };
findings.sort((a, b) => a[1].localeCompare(b[1]) || a[2] - b[2] || order[a[0]] - order[b[0]]);
console.log(`UI audit — ${dir}`);
console.log(`files: ${files.length} · expo ${expoVersion ?? '—'} · react-native ${installedVersion('react-native') ?? '—'} · keyboard-controller ${kcVersion ?? 'not installed'} · safe-area-context ${deps['react-native-safe-area-context'] ? installedVersion('react-native-safe-area-context') : 'not installed'}`);
let cur = null;
for (const [level, file, line, rule, msg] of findings) {
  if (file !== cur) {
    console.log(`\n${file}`);
    cur = file;
  }
  console.log(`  ${ICON[level]} ${line ? `${line}`.padStart(4) + '  ' : ''}[${rule}] ${msg}`);
}
const count = (l) => findings.filter((f) => f[0] === l).length;
console.log(`\n${count('fail')} fail, ${count('warn')} warn, ${count('info')} info — heuristic: open each file:line and confirm before changing it.`);
process.exit(count('fail') ? 1 : 0);

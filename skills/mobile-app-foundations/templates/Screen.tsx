// Screen — the one place a screen decides which safe-area edges it pads.
//
// Copy into the app (e.g. components/layout/Screen.tsx). Requires react-native-safe-area-context.
//
// `edges` is REQUIRED on purpose: every screen states which edges it owns, so nothing pads the
// same edge twice (double gap) and nothing is left unpadded (content under the notch / gesture bar).
//   stack screen, header shown, no tab bar ......... edges={['bottom']}
//   stack screen, headerShown: false ............... edges={['top', 'bottom']}
//   tab screen, header shown ....................... edges={[]}            (tab bar owns bottom)
//   tab screen, no header .......................... edges={['top']}
//   iOS modal / formSheet / pageSheet route ........ edges={['bottom']} + ownSafeArea
//   content of a React Native <Modal> .............. edges={['top', 'bottom']} + ownSafeArea
// Add 'left'/'right' when the app supports landscape (iPad, rotation).

import React from 'react';
import { ScrollView, StyleSheet, View, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

type ScreenProps = {
  /** Edges this screen pads itself. Omit 'top' under a visible header, 'bottom' above a visible tab bar. */
  edges: readonly Edge[];
  /** Scrollable content. The bottom inset then goes INSIDE the content, so it scrolls under the home indicator. */
  scroll?: boolean;
  /**
   * Measure insets where this screen really is, with its own SafeAreaProvider. Use for iOS sheet-style
   * routes (modal / formSheet / pageSheet) and React Native <Modal> content — there the root
   * provider reports full-window insets (e.g. 59 pt top) that don't apply.
   */
  ownSafeArea?: boolean;
  /** Screen background. Also paints the area under the status bar on edge-to-edge Android. */
  backgroundColor?: string;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  scrollProps?: Omit<ScrollViewProps, 'contentContainerStyle' | 'children'>;
  children?: React.ReactNode;
};

export function Screen(props: ScreenProps) {
  if (props.ownSafeArea) {
    return (
      <SafeAreaProvider style={{ flex: 1, backgroundColor: props.backgroundColor }}>
        <ScreenBody {...props} />
      </SafeAreaProvider>
    );
  }
  return <ScreenBody {...props} />;
}

function ScreenBody({ edges, scroll = false, backgroundColor, style, contentContainerStyle, scrollProps, children }: ScreenProps) {
  const insets = useSafeAreaInsets();
  const has = (e: Edge) => edges.includes(e);
  const sides = {
    paddingTop: has('top') ? insets.top : 0,
    paddingLeft: has('left') ? insets.left : 0,
    paddingRight: has('right') ? insets.right : 0,
  };
  const bottom = has('bottom') ? insets.bottom : 0;

  if (!scroll) {
    return <View style={[styles.fill, { backgroundColor }, sides, { paddingBottom: bottom }, style]}>{children}</View>;
  }
  return (
    <View style={[styles.fill, { backgroundColor }, sides, style]}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        {...scrollProps}
        contentContainerStyle={[{ flexGrow: 1, paddingBottom: bottom }, contentContainerStyle]}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });

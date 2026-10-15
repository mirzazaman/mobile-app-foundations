// FormScreen — keyboard-aware form with a primary action that is always reachable.
//
// Copy into the app (e.g. components/layout/FormScreen.tsx).
// Requires react-native-keyboard-controller (>= 1.13; works with the Expo SDK 54/55 pinned
// versions 1.18.5 / 1.20.7), a <KeyboardProvider> at the app root, and react-native-safe-area-context.
//
// What it guarantees:
//  - the focused input scrolls into view above the keyboard (on focus, on focus change between
//    fields, while a multiline field grows) with `gap` pt of space;
//  - with footerMode="sticky" the footer (Submit) rides on top of the keyboard, and the focused
//    field is kept above the footer, not just above the keyboard;
//  - with footerMode="inline" the footer is the last item of the scroll content;
//  - taps on buttons work on the FIRST tap while the keyboard is open (keyboardShouldPersistTaps);
//  - the bottom safe-area inset is padded once: by the container when closed, and tucked behind
//    the keyboard when it opens (KeyboardStickyView offset), so there is no double gap.
//
// `edges` has the same meaning as in Screen.tsx — which edges this screen owns.

import React, { forwardRef, useState } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { KeyboardAwareScrollView, KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

type FormScreenProps = {
  edges: readonly Edge[];
  /** The primary action(s), e.g. a Submit button. */
  footer?: React.ReactNode;
  /** 'sticky' floats the footer on the keyboard (single-task screens); 'inline' puts it after the fields (long forms). */
  footerMode?: 'sticky' | 'inline';
  /** Space between the focused input and whatever covers it (keyboard or sticky footer). */
  gap?: number;
  backgroundColor?: string;
  contentContainerStyle?: StyleProp<ViewStyle>;
  footerStyle?: StyleProp<ViewStyle>;
  children: React.ReactNode;
};

// The ref type follows the installed version: a ScrollView ref on keyboard-controller 1.18 (Expo SDK 54);
// from 1.20 (SDK 55) it also has `assureFocusedInputVisible()` — call it after layout changes under the
// focused field (e.g. a validation message appears).
type FormScreenRef = React.ElementRef<typeof KeyboardAwareScrollView>;

export const FormScreen = forwardRef<FormScreenRef, FormScreenProps>(function FormScreen(
  { edges, footer, footerMode = 'sticky', gap = 16, backgroundColor, contentContainerStyle, footerStyle, children },
  ref,
) {
  const insets = useSafeAreaInsets();
  const [footerHeight, setFooterHeight] = useState(0);
  const has = (e: Edge) => edges.includes(e);
  const bottomInset = has('bottom') ? insets.bottom : 0;
  const sticky = footer != null && footerMode === 'sticky';

  return (
    <View
      style={[
        styles.fill,
        {
          backgroundColor,
          paddingTop: has('top') ? insets.top : 0,
          paddingLeft: has('left') ? insets.left : 0,
          paddingRight: has('right') ? insets.right : 0,
          // Sticky footer: the container owns the inset, the footer sits above it.
          paddingBottom: sticky ? bottomInset : 0,
        },
      ]}
    >
      <KeyboardAwareScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        // Keep the focused field above the floating footer, not merely above the keyboard.
        bottomOffset={(sticky ? footerHeight : 0) + gap}
        contentContainerStyle={[
          styles.content,
          // Inline/no footer: the inset goes inside the content so it scrolls under the home indicator.
          { paddingBottom: sticky ? gap : bottomInset + gap },
          contentContainerStyle,
        ]}
      >
        {children}
        {footer != null && !sticky ? <View style={[styles.inlineFooter, footerStyle]}>{footer}</View> : null}
      </KeyboardAwareScrollView>

      {sticky ? (
        // offset.opened is positive = moves DOWN: hides the container's bottom inset behind the
        // keyboard, so the footer sits right on top of the keyboard instead of an inset higher.
        <KeyboardStickyView offset={{ closed: 0, opened: bottomInset }}>
          <View
            onLayout={(e) => setFooterHeight(e.nativeEvent.layout.height)}
            style={[styles.stickyFooter, { backgroundColor }, footerStyle]}
          >
            {footer}
          </View>
        </KeyboardStickyView>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { flexGrow: 1, padding: 16, gap: 12 },
  inlineFooter: { marginTop: 8 },
  // Own padding so a 0-inset device (iPhone SE) and the keyboard-open state still have breathing room.
  stickyFooter: { paddingHorizontal: 16, paddingVertical: 12 },
});

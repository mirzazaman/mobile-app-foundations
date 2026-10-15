// useFocusChain — "Next" on each field focuses the following one; the last field submits.
//
// Copy into the app (e.g. hooks/useFocusChain.ts). Needs React Native >= 0.71 (submitBehavior).
//
//   const field = useFocusChain(3, handleSubmit);
//   <TextInput {...field(0)} placeholder="Name" />
//   <TextInput {...field(1)} placeholder="Email" keyboardType="email-address" />
//   <TextInput {...field(2)} placeholder="Phone" keyboardType="phone-pad" />   // iOS: Done bar appears because returnKeyType is set
//
// Rules:
//  - Pass indexes in visual order, counting only fields that are rendered (skip hidden ones).
//  - Custom input components must forward `ref` and these props to the inner TextInput.
//  - Multiline fields: Return inserts a newline, so leave them out of the chain or give the screen a KeyboardToolbar.

import { useCallback, useRef } from 'react';
import type { TextInput, TextInputProps } from 'react-native';

type ChainProps = Pick<TextInputProps, 'returnKeyType' | 'submitBehavior' | 'onSubmitEditing'> & {
  ref: (input: TextInput | null) => void;
};

export function useFocusChain(count: number, onSubmit: () => void, lastReturnKey: TextInputProps['returnKeyType'] = 'done') {
  const refs = useRef<(TextInput | null)[]>([]);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  return useCallback(
    (index: number): ChainProps => {
      const isLast = index >= count - 1;
      return {
        ref: (input) => {
          refs.current[index] = input;
        },
        returnKeyType: isLast ? lastReturnKey : 'next',
        // 'submit' keeps the keyboard up while focus moves (no close/open flicker).
        submitBehavior: isLast ? 'blurAndSubmit' : 'submit',
        onSubmitEditing: () => {
          if (isLast) submitRef.current();
          else refs.current[index + 1]?.focus();
        },
      };
    },
    [count, lastReturnKey],
  );
}

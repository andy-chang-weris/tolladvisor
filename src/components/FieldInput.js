import { useState } from 'react';
import { TextInput, Platform } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function FieldInput({ value, onChangeText, placeholder, secureTextEntry, keyboardType, editable = true, onFocus, onBlur, large, label }) {
  const { C, s } = useTheme();
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      style={[
        s.input, large && s.inputLarge, focused && s.inputFocused, !editable && s.inputDisabled,
        Platform.OS === 'web' && { whiteSpace: 'nowrap' },
      ]}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={C.muted}
      secureTextEntry={secureTextEntry}
      keyboardType={keyboardType}
      editable={editable}
      multiline={false}
      textAlignVertical="center"
      accessibilityLabel={label}
      onFocus={() => { setFocused(true); onFocus && onFocus(); }}
      onBlur={() => { setFocused(false); onBlur && onBlur(); }}
    />
  );
}

import { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { FieldInput } from './FieldInput';

const BLUR_CLOSE_DELAY_MS = 150;

export function AddressInput({ value, onChangeText, placeholder, recents, onSelectRecent, onRemoveRecent, rightSlot, large, label }) {
  const { C, s } = useTheme();
  const [open, setOpen] = useState(false);
  const closeTimer = useRef(null);

  function handleFocus() {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }

  function handleBlur() {
    closeTimer.current = setTimeout(() => setOpen(false), BLUR_CLOSE_DELAY_MS);
  }

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  const showRecents = open && recents && recents.length > 0;

  return (
    <View>
      <View style={s.locRow}>
        <View style={{ flex: 1 }}>
          <FieldInput
            value={value}
            onChangeText={onChangeText}
            placeholder={placeholder}
            onFocus={handleFocus}
            onBlur={handleBlur}
            large={large}
            label={label}
          />
        </View>
        {rightSlot}
      </View>
      {showRecents && (
        <View
          style={s.recentsWrap}
          accessibilityLiveRegion="polite"
          accessibilityLabel={`${recents.length} recent address${recents.length === 1 ? '' : 'es'} available`}
        >
          <Text style={s.recentsLabel}>Recent</Text>
          {recents.map((addr, i) => (
            <View key={i} style={s.recentChip}>
              <TouchableOpacity
                style={s.recentChipTouch}
                onPress={() => { onSelectRecent(addr); setOpen(false); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Use recent address: ${addr}`}
              >
                <Text style={s.recentChipText} numberOfLines={1}>{addr}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={s.recentChipRemove}
                onPress={() => onRemoveRecent(addr)}
                accessibilityRole="button"
                accessibilityLabel={`Remove ${addr} from recent addresses`}
              >
                <Ionicons name="close" size={14} color={C.muted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

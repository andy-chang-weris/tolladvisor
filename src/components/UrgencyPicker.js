import { View, Text, TouchableOpacity } from 'react-native';
import { URGENCY_OPTIONS } from '../tollLogic';
import { useTheme } from '../theme/ThemeContext';

export function UrgencyPicker({ value, onChange }) {
  const { s } = useTheme();
  const current = URGENCY_OPTIONS.find(o => o.value === value) ?? URGENCY_OPTIONS[1];
  return (
    <View>
      <View style={{ marginBottom: 2 }}>
        <Text style={s.toggleLabel}>Trip urgency</Text>
        <Text style={s.toggleSub}>
          {`${current.description} — weighs your time saved ${current.weight}x`}
        </Text>
      </View>
      <View style={s.passGrid}>
        {URGENCY_OPTIONS.map(opt => {
          const active = opt.value === value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[s.passChip, active && s.passChipActive]}
              onPress={() => onChange(opt.value)}
              activeOpacity={0.7}
              hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
              accessibilityRole="button"
              accessibilityLabel={`Urgency: ${opt.label}, ${opt.description}`}
              accessibilityState={{ selected: active }}
            >
              <Text style={[s.passChipText, active && s.passChipTextActive]}>
                {opt.label}
              </Text>
              {active && (
                <Text style={[s.passChipSub, s.passChipTextActive]}>
                  {opt.description}
                </Text>
              )}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

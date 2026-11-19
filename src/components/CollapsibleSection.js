import { View, Text, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export function CollapsibleSection({ title, open, onToggle, children }) {
  const { C, s } = useTheme();
  return (
    <View style={s.collapseCard}>
      <TouchableOpacity
        style={s.collapseHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
      >
        <Text style={[s.cardTitle, { marginBottom: 0 }]}>{title}</Text>
        <Ionicons
          name={open ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={C.muted}
          importantForAccessibility="no"
        />
      </TouchableOpacity>
      {open && <View style={s.collapseBody}>{children}</View>}
    </View>
  );
}

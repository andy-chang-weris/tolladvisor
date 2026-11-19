import { Text } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function Label({ children, large, style }) {
  const { s } = useTheme();
  return <Text style={[s.label, large && s.labelLarge, style]}>{children}</Text>;
}

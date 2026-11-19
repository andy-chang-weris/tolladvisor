import { View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function Card({ children, style }) {
  const { s } = useTheme();
  return <View style={[s.card, style]}>{children}</View>;
}

import { Pressable, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTheme } from '../theme/ThemeContext';

export function SkeuButton({
  onPress, disabled, children, style, size = 'large', tone = 'default',
  accessibilityLabel, accessibilityRole = 'button', accessibilityState,
}) {
  const { C } = useTheme();
  const isIcon = size === 'icon';
  const subtle = tone === 'subtle';
  const radius = isIcon ? 10 : 12;
  const boxStyle = isIcon ? { width: 44, height: 44 } : { minHeight: 50 };
  const iconHitSlop = { top: 4, bottom: 4, left: 4, right: 4 };

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={[boxStyle, style, disabled && { opacity: 0.5 }]}
      hitSlop={isIcon ? iconHitSlop : undefined}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={accessibilityRole}
      accessibilityState={{ disabled: !!disabled, ...accessibilityState }}
    >
      {({ pressed }) => (
        <View
          style={{
            flex: 1,
            borderRadius: radius,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: pressed ? 0.5 : (subtle ? 1 : 2) },
            shadowOpacity: pressed ? 0.06 : (subtle ? 0.1 : 0.18),
            shadowRadius: pressed ? 1 : (subtle ? 2 : 3),
            elevation: pressed ? 1 : (subtle ? 2 : 3),
            backgroundColor: 'transparent',
          }}
        >
          <View style={{ flex: 1, borderRadius: radius, overflow: 'hidden' }}>
            <LinearGradient
              colors={subtle
                ? (pressed ? [C.blueBase, C.blueLight] : [C.blueLight, C.blueBase])
                : (pressed ? [C.blueBottom, C.blueBase] : [C.blueTop, C.blueBase, C.blueBottom])}
              locations={subtle ? [0, 1] : (pressed ? [0, 1] : [0, 0.55, 1])}
              start={{ x: 0, y: 0 }}
              end={{ x: 0, y: 1 }}
              style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
            >
              <View style={{ transform: [{ translateY: pressed ? 1 : 0 }] }}>
                {children}
              </View>
            </LinearGradient>
            <View
              pointerEvents="none"
              style={{
                position: 'absolute', left: 0, right: 0, bottom: 0,
                height: subtle ? 1.5 : 2,
                backgroundColor: C.blueEdge,
                opacity: pressed ? 0.25 : (subtle ? 0.5 : 0.9),
              }}
            />
          </View>
        </View>
      )}
    </Pressable>
  );
}

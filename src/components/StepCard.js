import { View, Text, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/ThemeContext';

export function StepPill({ state }) {
  const { C, s } = useTheme();
  const color  = state === 'running' ? C.blueText : state === 'done' ? C.teal : state === 'error' ? C.negRed : C.muted;
  const border = state === 'running' ? C.blueB : state === 'done' ? C.tealB : state === 'error' ? C.negRedB : C.border;
  return (
    <View style={[s.pill, { borderColor: border }]} accessibilityLabel={`Step status: ${state}`}>
      {state === 'running'
        ? <ActivityIndicator size={10} color={C.blueText} />
        : <Text style={[s.pillText, { color }]}>{state}</Text>
      }
    </View>
  );
}

export function StepCard({ num, title, state, children }) {
  const { C, s } = useTheme();
  const borderColor = state === 'running' ? C.blueB : state === 'done' ? C.tealB : state === 'error' ? C.negRedB : C.border;
  return (
    <View style={[s.step, { borderColor }]}>
      <View style={s.stepRow}>
        <View style={s.stepIcon}>
          <Text style={s.stepIconText} maxFontSizeMultiplier={1.3}>{String(num).padStart(2, '0')}</Text>
        </View>
        <Text style={s.stepTitle}>{title}</Text>
        <StepPill state={state} />
      </View>
      {(state === 'running' || state === 'done' || state === 'error') && children
        ? <View style={s.stepBody}>{children}</View>
        : null}
    </View>
  );
}

export function Connector() {
  const { s } = useTheme();
  return <View style={s.connector} />;
}

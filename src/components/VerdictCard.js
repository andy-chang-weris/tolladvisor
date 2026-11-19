import { View, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

export function VerdictCard({ verdict }) {
  const { C, s } = useTheme();

  if (!verdict.tollRoute) {
    return (
      <View style={[s.verdictCard, { backgroundColor: C.panel, borderColor: C.border2 }]}>
        <View style={s.verdictLabelRow}>
          <Ionicons name="information-circle-outline" size={14} color={C.text} importantForAccessibility="no" />
          <Text style={[s.verdictLabel, { color: C.text }]}>NO TOLL ROAD USED</Text>
        </View>
        <Text style={s.verdictText}>
          The fastest route to this destination doesn't use a toll road. This
          could mean there's no toll road here at all, or that a toll route
          exists but isn't fast enough to be selected over the free route.
        </Text>
      </View>
    );
  }

  const take        = verdict.recommendation === 'TAKE_TOLL';
  const bg          = take ? C.tealD : C.panel;
  const border      = take ? C.tealB : C.border2;
  const accentColor = take ? C.teal  : C.text;
  const delta       = (verdict.worthToPay ?? 0) - verdict.tollCost;
  const deltaColor  = delta >= 0 ? C.posGreen : C.negRed;
  return (
    <View style={[s.verdictCard, { backgroundColor: bg, borderColor: border }]}>
      <View style={s.verdictLabelRow}>
        <Ionicons
          name={take ? 'checkmark-circle-outline' : 'close-circle-outline'}
          size={14}
          color={accentColor}
          importantForAccessibility="no"
        />
        <Text style={[s.verdictLabel, { color: accentColor }]}>
          {take ? 'TAKE THE TOLL ROAD' : 'SKIP THE TOLL'}
        </Text>
      </View>
      <Text style={s.verdictText}>{verdict.reason}</Text>
      <View style={s.verdictStats}>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: accentColor }]}>{verdict.timeSavedMin}m</Text>
          <Text style={s.verdictStatLabel}>TIME SAVED</Text>
        </View>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: C.text }]}>${verdict.tollCost.toFixed(2)}</Text>
          <Text style={s.verdictStatLabel}>TOLL COST</Text>
        </View>
        <View style={s.verdictStat}>
          <Text style={[s.verdictStatNum, { color: deltaColor }]}>
            {delta >= 0 ? '+' : ''}${delta.toFixed(2)}
          </Text>
          <Text style={s.verdictStatLabel}>VALUE DELTA</Text>
        </View>
      </View>
    </View>
  );
}

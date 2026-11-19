import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ScrollView, Switch, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import { Label } from './Label';
import { FieldInput } from './FieldInput';
import { CollapsibleSection } from './CollapsibleSection';
import { UrgencyPicker } from './UrgencyPicker';

export function SettingsModal({
  visible, onClose,
  minTimeSaved, setMinTimeSaved, maxToll, setMaxToll,
  annualSalary, setAnnualSalary, urgencyLevel, setUrgencyLevel,
  theme, setTheme,
}) {
  const { C, s } = useTheme();
  const [configSectionOpen,    setConfigSectionOpen]    = useState(true);
  const [interfaceSectionOpen, setInterfaceSectionOpen] = useState(false);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={Platform.OS !== 'ios'}
      presentationStyle={Platform.OS === 'ios' ? 'pageSheet' : undefined}
      onRequestClose={onClose}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalPanel} accessibilityViewIsModal={true}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle} accessibilityRole="header">Settings</Text>
            <TouchableOpacity
              style={s.modalClose}
              onPress={onClose}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Close settings"
            >
              <Ionicons name="close" size={18} color={C.muted} />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }} keyboardShouldPersistTaps="handled">
            <CollapsibleSection
              title="Configuration"
              open={configSectionOpen}
              onToggle={() => setConfigSectionOpen(o => !o)}
            >
              <Label style={{ marginTop: 0 }}>Minimum time saved to take the toll</Label>
              <Text style={s.hint}>Only recommend the toll road if it saves at least this many minutes</Text>
              <FieldInput value={minTimeSaved} onChangeText={setMinTimeSaved} keyboardType="numeric" placeholder="10" label="Minimum time saved to take the toll, in minutes" />

              <Label>Most you're willing to pay in tolls</Label>
              <Text style={s.hint}>Won't recommend a toll that costs more than this</Text>
              <FieldInput value={maxToll} onChangeText={setMaxToll} keyboardType="numeric" placeholder="10" label="Most you're willing to pay in tolls, in dollars" />

              <Label>Your annual salary</Label>
              <Text style={s.hint}>Used to estimate what your time is worth per minute</Text>
              <FieldInput value={annualSalary} onChangeText={setAnnualSalary} keyboardType="numeric" placeholder="50000" label="Your annual salary, in dollars" />

              <View style={s.divider} />
              <UrgencyPicker value={urgencyLevel} onChange={setUrgencyLevel} />
            </CollapsibleSection>

            <CollapsibleSection
              title="Interface"
              open={interfaceSectionOpen}
              onToggle={() => setInterfaceSectionOpen(o => !o)}
            >
              <View style={s.interfaceRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.toggleLabel}>Light/Dark Mode</Text>
                </View>
                <Switch
                  value={theme === 'dark'}
                  onValueChange={v => setTheme(v ? 'dark' : 'light')}
                  trackColor={{ false: '#d1d5db', true: C.blue }}
                  thumbColor="#ffffff"
                  ios_backgroundColor="#d1d5db"
                  accessibilityLabel="Dark mode"
                  accessibilityRole="switch"
                />
              </View>
            </CollapsibleSection>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

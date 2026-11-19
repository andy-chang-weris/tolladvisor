import { useState, useEffect } from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export function useStoredPreferences() {
  const [minTimeSaved,     setMinTimeSaved]     = useState('10');
  const [maxToll,          setMaxToll]          = useState('10');
  const [annualSalary,     setAnnualSalary]     = useState('');
  const [urgencyLevel,     setUrgencyLevel]     = useState('med');
  const systemScheme = useColorScheme();
  const [theme,            setTheme]            = useState(systemScheme === 'light' ? 'light' : 'dark');
  const [hydrated,         setHydrated]          = useState(false);
  const [recentLocations,    setRecentLocations]    = useState([]);
  const [recentDestinations, setRecentDestinations] = useState([]);

  useEffect(() => {
    async function loadSettings() {
      try {
        const saved = await AsyncStorage.getItem('settings');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed.minTimeSaved)   setMinTimeSaved(parsed.minTimeSaved);
          if (parsed.maxToll)        setMaxToll(parsed.maxToll);
          if (parsed.annualSalary)   setAnnualSalary(parsed.annualSalary);
          if (parsed.urgencyLevel)   setUrgencyLevel(parsed.urgencyLevel);
        }
        const savedTheme = await AsyncStorage.getItem('theme');
        if (savedTheme === 'light' || savedTheme === 'dark') setTheme(savedTheme);

        const savedLocations = await AsyncStorage.getItem('recentLocations');
        if (savedLocations) setRecentLocations(JSON.parse(savedLocations));
        const savedDestinations = await AsyncStorage.getItem('recentDestinations');
        if (savedDestinations) setRecentDestinations(JSON.parse(savedDestinations));
      } catch {}
      setHydrated(true);
    }
    loadSettings();
  }, []);

  const RECENTS_MAX = 6;

  function upsertRecent(list, entry) {
    const trimmed = (entry || '').trim();
    if (!trimmed) return list;
    const filtered = list.filter(item => item.toLowerCase() !== trimmed.toLowerCase());
    return [trimmed, ...filtered].slice(0, RECENTS_MAX);
  }

  function pushRecentLocation(addr) {
    setRecentLocations(prev => {
      const next = upsertRecent(prev, addr);
      AsyncStorage.setItem('recentLocations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function pushRecentDestination(addr) {
    setRecentDestinations(prev => {
      const next = upsertRecent(prev, addr);
      AsyncStorage.setItem('recentDestinations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function removeRecentLocation(addr) {
    setRecentLocations(prev => {
      const next = prev.filter(a => a !== addr);
      AsyncStorage.setItem('recentLocations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  function removeRecentDestination(addr) {
    setRecentDestinations(prev => {
      const next = prev.filter(a => a !== addr);
      AsyncStorage.setItem('recentDestinations', JSON.stringify(next)).catch(() => {});
      return next;
    });
  }

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem('settings', JSON.stringify({
      minTimeSaved, maxToll, annualSalary, urgencyLevel,
    })).catch(() => {});
  }, [minTimeSaved, maxToll, annualSalary, urgencyLevel, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem('theme', theme).catch(() => {});
  }, [theme, hydrated]);

  return {
    minTimeSaved, setMinTimeSaved, maxToll, setMaxToll,
    annualSalary, setAnnualSalary, urgencyLevel, setUrgencyLevel,
    theme, setTheme,
    recentLocations, recentDestinations,
    pushRecentLocation, pushRecentDestination,
    removeRecentLocation, removeRecentDestination,
  };
}

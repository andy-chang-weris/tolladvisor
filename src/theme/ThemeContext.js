import { createContext, useContext } from 'react';
import { COLORS } from './colors';
import { makeStyles } from './styles';

export const ThemeContext = createContext({ theme: 'dark', C: COLORS.dark, s: makeStyles(COLORS.dark) });
export function useTheme() { return useContext(ThemeContext); }

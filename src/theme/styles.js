import { StyleSheet } from 'react-native';

export function makeStyles(C) {
  return StyleSheet.create({
    safe:           { flex: 1, backgroundColor: C.black },
    topbar:         { backgroundColor: C.dark, paddingHorizontal: 20, paddingTop: 56, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
    topbarRow:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    logoText:       { fontSize: 18, fontWeight: '800', color: C.text, letterSpacing: 2 },

    topbarRight:     { flexDirection: 'row', alignItems: 'center', gap: 12 },

    configSummary:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.dark, paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
    configSummaryText: { fontSize: 12, color: C.muted, flex: 1, marginRight: 8 },
    configSummaryEdit: { fontSize: 12, color: C.blueText, fontWeight: '600' },

    modalOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalPanel:     { backgroundColor: C.dark, borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '85%' },
    modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    modalTitle:     { fontSize: 16, fontWeight: '700', color: C.text },
    modalClose:     { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    scroll:         { flex: 1 },
    scrollContent:  { padding: 16 },

    card:           { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 16, marginBottom: 12 },
    cardTitle:      { fontSize: 12, fontWeight: '700', color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 14 },

    collapseCard:    { backgroundColor: C.panel, borderWidth: 1, borderColor: C.border, borderRadius: 12, marginBottom: 12, overflow: 'hidden' },
    collapseHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, minHeight: 44 },
    collapseBody:    { paddingHorizontal: 16, paddingBottom: 16 },

    interfaceRow:    { flexDirection: 'row', alignItems: 'center', gap: 12 },

    label:          { fontSize: 12, color: C.muted, marginBottom: 4, marginTop: 10, letterSpacing: 0.5 },
    labelLarge:     { fontSize: 14, marginTop: 12 },
    hint:           { fontSize: 12, color: C.muted, opacity: 0.7, marginBottom: 6, lineHeight: 16 },
    input:          { backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, minHeight: 44 },
    inputLarge:     { fontSize: 17, paddingVertical: 14, fontWeight: '500', minHeight: 50 },
    inputFocused:   { borderColor: C.blueB },
    inputDisabled:  { opacity: 0.5 },

    locRow:         { flexDirection: 'row', gap: 8, alignItems: 'flex-start' },

    recentsWrap:       { marginTop: 6 },
    recentsLabel:      { fontSize: 11, color: C.muted, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 4 },
    recentChip:        { flexDirection: 'row', alignItems: 'center', backgroundColor: C.black, borderWidth: 1, borderColor: C.border, borderRadius: 8, paddingHorizontal: 4, marginBottom: 4, minHeight: 44 },
    recentChipTouch:    { flex: 1, minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 },
    recentChipText:    { fontSize: 13, color: C.text },
    recentChipRemove:  { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },

    divider:        { height: 1, backgroundColor: C.border, marginTop: 16, marginBottom: 4 },

    toggleLabel:    { fontSize: 14, color: C.text, fontWeight: '600' },
    toggleSub:      { fontSize: 12, color: C.muted, marginTop: 2 },

    passGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
    passChip:       { borderWidth: 1, borderColor: C.border2, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 10, minHeight: 40, justifyContent: 'center' },
    passChipActive: { borderColor: C.blue, backgroundColor: C.blueD },
    passChipText:   { fontSize: 12, color: C.muted },
    passChipTextActive: { color: C.blueText, fontWeight: '600' },
    passChipSub:    { fontSize: 11, marginTop: 2 },

    sectionLabel:   { fontSize: 12, color: C.muted, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 10, marginTop: 4 },

    compactSummary:     { marginBottom: 10 },
    compactSummaryRow:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
    compactSummaryText: { fontSize: 14, color: C.text, fontWeight: '600' },
    compactSummarySub:  { fontSize: 12, color: C.muted, marginTop: 2, marginLeft: 13 },

    step:           { backgroundColor: C.panel, borderWidth: 1, borderRadius: 12, padding: 14, marginBottom: 2 },
    stepRow:        { flexDirection: 'row', alignItems: 'center', gap: 10 },
    stepIcon:       { width: 32, height: 32, borderRadius: 8, backgroundColor: C.black, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
    stepIconText:   { fontSize: 11, fontWeight: '700', color: C.muted },
    stepTitle:      { flex: 1, fontSize: 14, fontWeight: '600', color: C.text },
    stepBody:       { marginTop: 12 },
    pill:           { borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
    pillText:       { fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },

    connector:      { width: 1, height: 16, backgroundColor: C.border, marginLeft: 30, marginVertical: 1 },

    roadBadge:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.border2, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', marginBottom: 6 },
    roadDot:        { width: 7, height: 7, borderRadius: 4 },
    roadBadgeText:  { fontSize: 13, color: C.text },
    roadFormatted:  { fontSize: 13, color: C.muted, marginTop: 2 },

    routesGrid:     { flexDirection: 'row', gap: 8 },
    routeCard:      { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 },
    routeType:      { fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 6 },
    routeName:      { fontSize: 13, fontWeight: '600', color: C.text, marginBottom: 8, lineHeight: 17 },
    routeStat:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: C.border },
    routeStatLast:  { borderBottomWidth: 0 },
    routeStatLabel: { fontSize: 12, color: C.muted },
    routeStatValue: { fontSize: 12, color: C.text, fontWeight: '500' },
    noFreeNote:     { fontSize: 12, color: C.muted, marginTop: 8, fontStyle: 'italic' },

    verdictCard:      { borderWidth: 1, borderRadius: 10, padding: 14 },
    verdictLabelRow:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
    verdictLabel:     { fontSize: 12, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
    verdictText:      { fontSize: 14, color: C.text, lineHeight: 20, marginBottom: 12 },
    verdictStats:     { flexDirection: 'row', gap: 6 },
    verdictStat:      { flex: 1, alignItems: 'center', backgroundColor: C.black, borderRadius: 8, padding: 10 },
    verdictStatNum:   { fontSize: 20, fontWeight: '800', marginBottom: 4 },
    verdictStatLabel: { fontSize: 11, color: C.muted, letterSpacing: 1 },

    notifBar:       { backgroundColor: C.blueD, borderWidth: 1, borderColor: C.blueB, borderRadius: 8, padding: 12, marginTop: 12 },
    notifText:      { fontSize: 13, color: C.blueText, textAlign: 'center' },

    geofenceBar:    { backgroundColor: C.blueD, borderWidth: 1, borderColor: C.blueB, borderRadius: 8, padding: 12, marginTop: 8 },
    geofenceText:   { fontSize: 13, color: C.blueText, textAlign: 'center' },

    errorBar:       { backgroundColor: C.negRedD, borderWidth: 1, borderColor: C.negRedB, borderRadius: 8, padding: 12, marginTop: 12 },
    errorText:      { fontSize: 13, color: C.negRed },

    btnRow:         { marginTop: 16 },
    primaryBtnText: { fontSize: 15, fontWeight: '700', color: '#ffffff', letterSpacing: 0.5 },
  });
}

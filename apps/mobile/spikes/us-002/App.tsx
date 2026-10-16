import { useEffect, useState } from 'react';
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { finishInstrument, runInstrument } from './harness';

// One run per JS process, including React development effect replay.
const instrument = runInstrument();

export default function App() {
  const [status, setStatus] = useState('Executando verificações nativas…');
  const [canFinish, setCanFinish] = useState(false);
  useEffect(() => {
    instrument
      .then((report) => {
        // Explicit sanitized evidence channel: only booleans, platform/version and fixed codes.
        console.info('US002_REPORT ' + JSON.stringify(report));
        setStatus(JSON.stringify(report, null, 2));
        setCanFinish(report.passed && report.phase === 'reopened');
      })
      .catch(() => setStatus('REPORT_WRITE_FAILED'));
  }, []);

  return (
    <SafeAreaView style={styles.page}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>
          US-002 · Cofre Mobile
        </Text>
        <Text>
          Instrumento técnico com dados sintéticos. Sem conta cloud,
          sincronização ou dados reais.
        </Text>
        <Text selectable testID="us002-report" style={styles.report}>
          {status}
        </Text>
        {canFinish && (
          <Button
            title="Limpar fixtures sintéticas"
            testID="us002-cleanup"
            onPress={() => {
              setCanFinish(false);
              finishInstrument()
                .then(() => setStatus('CLEANUP_PASSED'))
                .catch(() => setStatus('CLEANUP_FAILED'));
            }}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f6f8' },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: '#17365d' },
  report: { fontSize: 13, color: '#142536' },
});

import { registerRootComponent } from 'expo';
import { useEffect, useState, createElement } from 'react';
import { Text, ScrollView } from 'react-native';
import { runNativeProbe } from './probe';
const run = runNativeProbe();
function App() {
  const [result, setResult] = useState('US-021: verificando schema sintético…');
  useEffect(() => {
    run
      .then((report) => {
        console.info('US021_REPORT ' + JSON.stringify(report));
        setResult(JSON.stringify(report, null, 2));
      })
      .catch(() => setResult('NATIVE_REPORT_FAILED'));
  }, []);
  return createElement(
    ScrollView,
    { contentContainerStyle: { padding: 24 } },
    createElement(Text, { selectable: true }, result),
  );
}
registerRootComponent(App);

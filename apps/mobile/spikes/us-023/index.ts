import { registerRootComponent } from 'expo';
import { createElement, useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { runIdentityNativeProbe } from './probe';
const run = runIdentityNativeProbe();
function App() {
  const [status, setStatus] = useState(
    'US-023: verificando IDs e tempo sintéticos…',
  );
  useEffect(() => {
    run
      .then((report) => {
        console.info('US023_REPORT ' + JSON.stringify(report));
        setStatus(JSON.stringify(report, null, 2));
      })
      .catch(() => setStatus('IDENTITY_REPORT_FAILED'));
  }, []);
  return createElement(
    ScrollView,
    { contentContainerStyle: { padding: 24 } },
    createElement(Text, { selectable: true }, status),
  );
}
registerRootComponent(App);

import { useState } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { contentStates, tokens } from '@financial-manager/design-tokens';
import type {
  ContentState,
  ShellRoute,
  WorkspaceSummary,
} from '@financial-manager/design-tokens';
import { NativeShell } from './native-shell.js';
import { createMobileShellModel } from './configuration.js';
import {
  disabledConfiguration,
  parseConfiguration,
} from '@financial-manager/runtime-config';

const spaces: readonly WorkspaceSummary[] = [
  { id: 'synthetic-mobile-one', name: 'Equipe de exemplo', mode: 'cloud' },
  {
    id: 'synthetic-mobile-two',
    name: 'Segundo espaço de exemplo',
    mode: 'cloud',
  },
];
// Mount inside the app's safe-area host. This does not replace the US-002 entry.
export function NativeShellExample() {
  const [configuration, setConfiguration] = useState(
    disabledConfiguration('local'),
  );
  const [workspace, setWorkspace] = useState(spaces[0]!);
  const [route, setRoute] = useState<ShellRoute>('overview');
  const [state, setState] = useState<ContentState>('empty');
  const model = createMobileShellModel(
    {
      workspace,
      route,
      state,
      sync: 'current',
    },
    configuration,
  );
  return (
    <View style={styles.root}>
      <NativeShell
        model={model}
        workspaces={spaces}
        onWorkspaceChange={(id) => {
          setWorkspace(spaces.find((item) => item.id === id)!);
          setRoute('overview');
          setState('empty');
        }}
        onNavigate={(next) => {
          setRoute(next);
          setState('empty');
        }}
        onRetry={() => setState('empty')}
      >
        <Text allowFontScaling style={styles.text}>
          Demonstração com dados sintéticos. Nenhuma conta financeira está
          conectada.
        </Text>
      </NativeShell>
      <View style={styles.controls} accessibilityLabel="Estado do exemplo">
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          onPress={() => {
            const enabled = !configuration.features.importReview;
            setConfiguration(
              parseConfiguration(
                {
                  format_version: 1,
                  environment: 'local',
                  revision: configuration.revision + 1,
                  features: {
                    importReview: enabled,
                    documentReview: enabled,
                    reports: enabled,
                  },
                },
                'local',
              ),
            );
            setRoute('overview');
            setState('empty');
          }}
        >
          <Text allowFontScaling style={styles.text}>
            {configuration.features.importReview
              ? 'Mostrar somente recursos básicos'
              : 'Mostrar todas as seções de exemplo'}
          </Text>
        </Pressable>
        {(Object.keys(contentStates) as ContentState[]).map((id) => (
          <Pressable
            key={id}
            accessibilityRole="button"
            accessibilityState={{ selected: state === id }}
            style={styles.button}
            onPress={() => setState(id)}
          >
            <Text allowFontScaling style={styles.text}>
              {contentStates[id].title}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  text: { color: tokens.color.text, fontSize: tokens.typography.body.size },
  controls: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    padding: tokens.space.sm,
    gap: tokens.space.sm,
  },
  button: {
    minHeight: tokens.control.nativeMinTarget,
    padding: tokens.space.md,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
  },
});

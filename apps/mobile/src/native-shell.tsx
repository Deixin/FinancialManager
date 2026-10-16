import { useState } from 'react';
import type { ReactNode } from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { tokens, contentStates } from '@financial-manager/design-tokens';
import type {
  ShellModel,
  ShellRoute,
  WorkspaceSummary,
} from '@financial-manager/design-tokens';

export type NativeShellProps = Readonly<{
  model: ShellModel;
  workspaces: readonly WorkspaceSummary[];
  onWorkspaceChange: (id: string) => void;
  onNavigate: (route: ShellRoute) => void;
  onRetry?: () => void;
  onSearch?: () => void;
  children?: ReactNode;
}>;

export function NativeShell({
  model,
  workspaces,
  onWorkspaceChange,
  onNavigate,
  onRetry,
  onSearch,
  children,
}: NativeShellProps) {
  const [chooser, setChooser] = useState(false);
  const [more, setMore] = useState(false);
  if (model.surface !== 'mobile' || model.workspace.mode !== 'cloud')
    throw new Error('UI_SHELL_SURFACE_INVALID');
  const notice = contentStates[model.state];
  const secondary = model.navigation.filter(
    (route) => !['overview', 'movements'].includes(route.id),
  );
  const button = (label: string, action: () => void, selected = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={action}
      style={({ pressed }) => [
        styles.button,
        selected && styles.selected,
        pressed && styles.pressed,
      ]}
    >
      <Text style={styles.buttonText} allowFontScaling>
        {label}
      </Text>
    </Pressable>
  );
  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand} allowFontScaling>
          Financial Manager
        </Text>
        <Pressable
          style={styles.button}
          accessibilityRole="button"
          accessibilityLabel={`Espaço ativo: ${model.workspace.name}. Escolher espaço`}
          accessibilityState={{ expanded: chooser }}
          onPress={() => setChooser(!chooser)}
        >
          <Text style={styles.title} allowFontScaling>
            {model.workspace.name}
          </Text>
          <Text style={styles.muted} allowFontScaling>
            Nuvem · {model.locationDescription}
          </Text>
        </Pressable>
        {chooser && (
          <View accessibilityLabel="Escolher espaço">
            {workspaces
              .filter((item) => item.mode === 'cloud')
              .map((item) => (
                <View key={item.id}>
                  {button(
                    item.name,
                    () => {
                      setChooser(false);
                      onWorkspaceChange(item.id);
                    },
                    item.id === model.workspace.id,
                  )}
                </View>
              ))}
          </View>
        )}
        {onSearch && button('Buscar no espaço', onSearch)}
        {model.partial && (
          <Text style={styles.partial} allowFontScaling>
            Visão parcial: somente contas autorizadas.
          </Text>
        )}
        <View key={model.workspace.id} style={styles.body}>
          <Text
            accessibilityRole="header"
            style={styles.title}
            allowFontScaling
          >
            {model.title}
          </Text>
          {model.state !== 'ready' && (
            <View
              style={[
                styles.notice,
                { backgroundColor: tokens.state[notice.tone].background },
              ]}
              accessibilityLiveRegion="polite"
            >
              <Text
                accessibilityRole="header"
                style={[
                  styles.subtitle,
                  { color: tokens.state[notice.tone].foreground },
                ]}
                allowFontScaling
              >
                {notice.title}
              </Text>
              <Text
                style={{
                  color: tokens.state[notice.tone].foreground,
                  fontSize: tokens.typography.body.size,
                }}
                allowFontScaling
              >
                {notice.description}
              </Text>
              {model.state === 'error' &&
                onRetry &&
                button('Tentar novamente', onRetry)}
            </View>
          )}
          {(model.state === 'ready' || model.state === 'partial') && children}
        </View>
        {more && (
          <View accessibilityLabel="Mais seções" style={styles.body}>
            {secondary.map((item) => (
              <View key={item.id}>
                {button(
                  item.label,
                  () => {
                    setMore(false);
                    onNavigate(item.id);
                  },
                  item.selected,
                )}
              </View>
            ))}
          </View>
        )}
      </ScrollView>
      <View style={styles.navigation} accessibilityLabel="Navegação principal">
        {button(
          'Início',
          () => {
            setMore(false);
            onNavigate('overview');
          },
          model.route === 'overview',
        )}
        {button(
          'Movimentos',
          () => {
            setMore(false);
            onNavigate('movements');
          },
          model.route === 'movements',
        )}
        <Pressable
          style={[styles.button, more && styles.selected]}
          accessibilityRole="button"
          accessibilityLabel="Mais seções"
          accessibilityState={{
            expanded: more,
            selected: secondary.some((route) => route.selected),
          }}
          onPress={() => setMore(!more)}
        >
          <Text style={styles.buttonText} allowFontScaling>
            Mais
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: tokens.color.canvas },
  content: { padding: tokens.space.xl, gap: tokens.space.lg, flexGrow: 1 },
  brand: {
    fontSize: tokens.typography.body.size,
    fontWeight: '700',
    color: tokens.color.brand,
  },
  title: {
    fontSize: tokens.typography.title.size,
    fontWeight: '700',
    color: tokens.color.text,
    flexShrink: 1,
  },
  subtitle: { fontSize: tokens.typography.title.size, fontWeight: '600' },
  muted: {
    fontSize: tokens.typography.caption.size,
    color: tokens.color.muted,
  },
  button: {
    minHeight: tokens.control.nativeMinTarget,
    padding: tokens.space.md,
    borderWidth: 1,
    borderColor: tokens.color.border,
    borderRadius: tokens.radius.control,
    justifyContent: 'center',
    flexShrink: 1,
    backgroundColor: tokens.color.surface,
  },
  buttonText: {
    fontSize: tokens.typography.label.size,
    fontWeight: '600',
    color: tokens.color.brand,
    flexShrink: 1,
  },
  selected: {
    backgroundColor: tokens.color.brandSubtle,
    borderWidth: 2,
    borderColor: tokens.color.brand,
  },
  pressed: { backgroundColor: tokens.color.brandSubtle },
  notice: {
    padding: tokens.space.lg,
    gap: tokens.space.md,
    borderRadius: tokens.radius.panel,
  },
  partial: {
    padding: tokens.space.md,
    color: tokens.state.warning.foreground,
    backgroundColor: tokens.state.warning.background,
    fontSize: tokens.typography.body.size,
  },
  body: { gap: tokens.space.lg },
  navigation: {
    padding: tokens.space.lg,
    gap: tokens.space.sm,
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: tokens.color.surface,
    borderTopWidth: 1,
    borderTopColor: tokens.color.subtleBorder,
  },
});

import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HapticTab } from '@/components/haptic-tab';
import { JamboIcon, type JamboIconName } from '@/components/jambo/icons';
import { JamboFonts } from '@/constants/jambo-theme';
import { useJamboTheme } from '@/hooks/use-jambo-theme';

/** No design o rotulo ativo fica em negrito, entao ele e renderizado a mao. */
function tabLabel(title: string) {
  return function TabLabel({ focused, color }: { focused: boolean; color: string }) {
    return (
      <Text style={{ color, fontFamily: focused ? JamboFonts.bodyBold : JamboFonts.body, fontSize: 11 }}>
        {title}
      </Text>
    );
  };
}

function tabIcon(name: JamboIconName) {
  return function TabIcon({ color }: { color: string }) {
    return <JamboIcon name={name} size={23} color={color} />;
  };
}

export default function TabLayout() {
  const { palette } = useJamboTheme();
  // Sem o inset, os rotulos ficam atras da barra de navegacao do sistema.
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.textMuted,
        tabBarStyle: {
          height: 78 + insets.bottom,
          paddingTop: 10,
          paddingBottom: insets.bottom,
          backgroundColor: palette.tabBar,
          borderTopColor: palette.tabBarBorder,
          borderTopWidth: 1,
          elevation: 0,
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{ title: 'Criar', tabBarIcon: tabIcon('plus'), tabBarLabel: tabLabel('Criar') }}
      />
      <Tabs.Screen
        name="packs"
        options={{ title: 'Pacotes', tabBarIcon: tabIcon('folder'), tabBarLabel: tabLabel('Pacotes') }}
      />
    </Tabs>
  );
}

import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { colors } from "@/constants/theme";
import "@/global.css";

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="processing" />
        <Stack.Screen name="batch" />
        <Stack.Screen name="result" />
        <Stack.Screen name="settings" />
      </Stack>
    </ThemeProvider>
  );
}
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import "@/global.css";

export default function RootLayout() {
  return (
    <ThemeProvider value={DarkTheme}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="processing" />
        <Stack.Screen name="result" />
        <Stack.Screen name="settings" />
      </Stack>
    </ThemeProvider>
  );
}
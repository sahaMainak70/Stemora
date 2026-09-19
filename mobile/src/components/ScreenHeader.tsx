import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ChevronLeft } from "lucide-react-native";
import { colors } from "@/constants/theme";

type ScreenHeaderProps = {
  title: string;
};

export function ScreenHeader({ title }: ScreenHeaderProps) {
  const router = useRouter();

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  }

  return (
    <View className="flex-row items-center gap-3 pb-3 pt-2">
      <Pressable
        onPress={goBack}
        hitSlop={8}
        className="h-10 w-10 items-center justify-center rounded-full border border-subtle bg-surface"
      >
        <ChevronLeft size={20} color={colors.primary} />
      </Pressable>
      <Text className="text-xl font-semibold text-primary">{title}</Text>
    </View>
  );
}
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useNemiAuthInstance } from "./NemiProvider";
import { useCallback, useState } from "react";
import { NemiCancelledError } from "../errors";

export type SignInWithNemiButtonTheme = "dark" | "light";
export type SignInWithNemiButtonSize = "small" | "medium" | "large";

export interface SignInWithNemiButtonProps {
  /** Custom press handler. Without it, the button calls `signIn()` of the nearest NemiProvider. */
  onPress?: (event: GestureResponderEvent) => void;
  /** `dark` (default): black pill with white text. `light`: white pill with a black outline, for dark backgrounds. */
  theme?: SignInWithNemiButtonTheme;
  size?: SignInWithNemiButtonSize;
  /** Shows a spinner and blocks presses. Set automatically while the built-in sign in runs. */
  loading?: boolean;
  disabled?: boolean;
  /** Text before the wordmark. Default "Sign in with". */
  label?: string;
  /** Stretch to the parent's width. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const SIZES: Record<SignInWithNemiButtonSize, { height: number; paddingHorizontal: number; fontSize: number }> = {
  small: { height: 36, paddingHorizontal: 16, fontSize: 14 },
  medium: { height: 44, paddingHorizontal: 22, fontSize: 16 },
  large: { height: 52, paddingHorizontal: 28, fontSize: 18 },
};

const COLORS = {
  dark: { background: "#000000", pressed: "#262626", text: "#FFFFFF", border: "#000000" },
  light: { background: "#FFFFFF", pressed: "#EDEDED", text: "#000000", border: "#000000" },
};

/** "Sign in with Nemi" button: a black (or white) pill with the Nemi wordmark. */
export function SignInWithNemiButton({
  onPress,
  theme = "dark",
  size = "medium",
  loading,
  disabled,
  label = "Sign in with",
  fullWidth,
  style,
  testID,
}: SignInWithNemiButtonProps) {
  const auth = useNemiAuthInstance();
  const [running, setRunning] = useState(false);
  const busy = loading ?? running;
  const colors = COLORS[theme];
  const dims = SIZES[size];

  const handlePress = useCallback(
    async (event: GestureResponderEvent) => {
      if (onPress) return onPress(event);
      if (!auth) {
        console.warn("[nemi] SignInWithNemiButton needs a NemiProvider or an onPress handler.");
        return;
      }
      setRunning(true);
      try {
        await auth.signIn();
      } catch (err) {
        if (!(err instanceof NemiCancelledError)) console.warn("[nemi] sign in failed:", err);
      } finally {
        setRunning(false);
      }
    },
    [auth, onPress],
  );

  const inactive = Boolean(disabled || busy);

  return (
    <Pressable
      testID={testID}
      onPress={handlePress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={`${label} Nemi`}
      accessibilityState={{ disabled: inactive, busy }}
      style={({ pressed }) => [
        styles.base,
        {
          height: dims.height,
          paddingHorizontal: dims.paddingHorizontal,
          borderRadius: dims.height / 2,
          backgroundColor: pressed ? colors.pressed : colors.background,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={colors.text} />
      ) : (
        <View style={styles.row}>
          <Text style={[styles.label, { color: colors.text, fontSize: dims.fontSize }]} numberOfLines={1}>
            {label}{" "}
            <Text style={styles.wordmark}>Nemi</Text>
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    minWidth: 160,
  },
  row: { flexDirection: "row", alignItems: "center" },
  label: { fontWeight: "500", letterSpacing: 0.1 },
  wordmark: { fontWeight: "800", letterSpacing: -0.3 },
});

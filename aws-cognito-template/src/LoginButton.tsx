import type { ReactNode } from "react";
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
} from "react-native";

interface Props {
  onPress: () => void;
  label: string;
  disabled?: boolean;
  loading?: boolean;
  icon?: ReactNode;
  variant?: "light" | "dark";
}

export default function LoginButton({
  onPress,
  label,
  disabled,
  loading = false,
  icon,
  variant = "light",
}: Props) {
  const isDark = variant === "dark";

  return (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: loading }}
      style={[
        styles.button,
        isDark && styles.buttonDark,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      {loading ? (
        <ActivityIndicator color={isDark ? "#fff" : "#374151"} />
      ) : (
        <>
          {icon}
          <Text style={[styles.buttonText, isDark && styles.buttonTextDark]}>
            {label}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#fff",
    width: "100%",
    minHeight: 48,
  },
  buttonDark: {
    backgroundColor: "#000",
    borderColor: "#000",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonText: {
    fontSize: 15,
    fontWeight: "500",
    color: "#374151",
  },
  buttonTextDark: {
    color: "#fff",
  },
});

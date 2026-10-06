import { View, Text, Image, TouchableOpacity, StyleSheet } from "react-native";
import type { AuthUser } from "./auth";

interface Props {
  user: AuthUser;
  onSignOut: () => void;
}

export default function UserProfile({ user, onSignOut }: Props) {
  return (
    <View style={styles.card}>
      {user.picture && (
        <Image source={{ uri: user.picture }} style={styles.avatar} />
      )}
      {user.name && <Text style={styles.name}>{user.name}</Text>}
      <Text style={styles.email}>{user.email}</Text>
      <TouchableOpacity
        style={styles.signOutBtn}
        onPress={onSignOut}
        activeOpacity={0.8}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    gap: 12,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 32,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 4,
    width: "100%",
    maxWidth: 360,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    marginBottom: 4,
  },
  name: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1e293b",
  },
  email: {
    fontSize: 14,
    color: "#64748b",
  },
  signOutBtn: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 24,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#fecaca",
    backgroundColor: "#fff",
  },
  signOutText: {
    color: "#ef4444",
    fontWeight: "500",
    fontSize: 14,
  },
});

import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  useColorScheme,
  useWindowDimensions,
  View,
} from "react-native";
import type { Photo } from "@guuslab/nemi";
import { NemiProvider, SignInWithNemiButton, useNemi } from "@guuslab/nemi-react-native";

// Register this exact redirect URI on your app at https://dev.nemilab.com.
const CLIENT_ID = "nemi_app_REPLACE_ME";
const REDIRECT_URI = "com.example.nemidemo:/oauthredirect";

export default function App() {
  return (
    <NemiProvider
      clientId={CLIENT_ID}
      redirectUri={REDIRECT_URI}
      scopes={["openid", "profile", "email", "offline_access", "gallery.read"]}
    >
      <Home />
    </NemiProvider>
  );
}

function Home() {
  const { user, isLoading, isSignedIn, signOut, error } = useNemi();
  const dark = useColorScheme() === "dark";
  const fg = dark ? "#fff" : "#000";

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: dark ? "#000" : "#fff" }]}>
      {isLoading && !isSignedIn ? (
        <ActivityIndicator style={styles.center} />
      ) : !isSignedIn ? (
        <View style={styles.center}>
          <Text style={[styles.title, { color: fg }]}>Nemi example</Text>
          <SignInWithNemiButton theme={dark ? "light" : "dark"} size="large" />
          {error ? <Text style={styles.error}>{error.message}</Text> : null}
        </View>
      ) : (
        <>
          <View style={styles.header}>
            {user?.picture ? <Image source={{ uri: user.picture }} style={styles.avatar} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={[styles.name, { color: fg }]}>{user?.name ?? user?.username ?? "Signed in"}</Text>
              {user?.email ? <Text style={styles.muted}>{user.email}</Text> : null}
            </View>
            <Pressable accessibilityRole="button" onPress={signOut} style={styles.signOut}>
              <Text style={{ color: fg }}>Sign out</Text>
            </Pressable>
          </View>
          <Gallery />
        </>
      )}
    </SafeAreaView>
  );
}

function Gallery() {
  const { client } = useNemi();
  const { width } = useWindowDimensions();
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFailure(null);
    try {
      // Thumbnail URLs expire after 15 minutes: fetch again instead of caching them.
      const page = await client.gallery.photos.list({ limit: 60 });
      setPhotos(page.photos);
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const size = Math.floor(width / 3);
  if (failure) return <Text style={styles.error}>{failure}</Text>;
  return (
    <FlatList
      data={photos}
      keyExtractor={(p) => p.id}
      numColumns={3}
      refreshing={loading}
      onRefresh={load}
      renderItem={({ item }) => (
        <Image source={{ uri: item.thumbnailUrl }} style={{ width: size, height: size }} accessibilityLabel={item.name} />
      )}
      ListEmptyComponent={loading ? null : <Text style={[styles.muted, styles.empty]}>No photos yet.</Text>}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24, padding: 24 },
  title: { fontSize: 28, fontWeight: "700" },
  header: { flexDirection: "row", alignItems: "center", gap: 12, padding: 16 },
  avatar: { width: 48, height: 48, borderRadius: 24 },
  name: { fontSize: 18, fontWeight: "600" },
  muted: { color: "#888" },
  signOut: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: "#888" },
  error: { color: "#d33", padding: 16, textAlign: "center" },
  empty: { textAlign: "center", padding: 32 },
});

// app/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { BottomTabBar, BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BookingUIProvider, useBookingUI } from '@/context/BookingUIContext';

// ---------------------------------------------------------------------------
// ✅ NEW — custom tab bar.
//
// Normally renders the standard Home / Bookings / Profile tab bar
// (react-navigation's own <BottomTabBar>, unchanged look/behavior). But the
// instant the customer screen reports (via BookingUIContext) that a
// location, a service, AND a vehicle are all selected, this swaps the
// entire tab bar out for a single full-width "Book Now" bar — same idea as
// a checkout screen replacing tab navigation with a single primary action.
//
// Tapping it calls `onBookNow` (wired up by customer.tsx to createBooking
// for the currently chosen service) directly — no navigation involved, so
// the person stays on the Home screen and sees the normal
// "Finding a Mechanic" flow right away.
// ---------------------------------------------------------------------------
function AppTabBar(props: BottomTabBarProps) {
  const { canBookNow, price, loading, onBookNow } = useBookingUI();
  const insets = useSafeAreaInsets();

  if (!canBookNow) {
    return <BottomTabBar {...props} />;
  }

  return (
    <View style={[styles.bookNowBar, { paddingBottom: Math.max(insets.bottom, 12) }]}>
       <TouchableOpacity style={styles.cashRow} activeOpacity={0.7}>
                    <View style={styles.cashRowLeft}>
                      <Ionicons name="wallet-outline" size={20} color="#0F172A" />
                      <Text style={styles.cashRowText}>Cash</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={20} color="#94A3B8" />
                  </TouchableOpacity>
      <TouchableOpacity
        style={[styles.bookNowButton, loading && styles.bookNowButtonDisabled]}
        activeOpacity={0.85}
        disabled={loading || !onBookNow}
        onPress={() => onBookNow && onBookNow()}
      >
        {loading ? (
          <ActivityIndicator color="#FFF" size="small" />
        ) : (
          <Text style={styles.bookNowButtonText}>
            Book Now{price != null ? ` · ₹${Math.round(price)}` : ''}
          </Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <BookingUIProvider>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: '#063F47',
          tabBarInactiveTintColor: '#8E8E93',
        }}
        tabBar={(props) => <AppTabBar {...props} />}
      >
        <Tabs.Screen
          name="customer"
          options={{
            title: 'Home',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'car' : 'car-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="bookings"
          options={{
            title: 'Bookings',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'receipt' : 'receipt-outline'} color={color} size={size} />
            ),
          }}
        />
        <Tabs.Screen
          name="profile"
          options={{
            title: 'Profile',
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? 'person-circle' : 'person-circle-outline'} color={color} size={size} />
            ),
          }}
        />
      </Tabs>
    </BookingUIProvider>
  );
}

const styles = StyleSheet.create({
  bookNowBar: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    paddingHorizontal: 16,
    paddingTop: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 8,
  },
  bookNowButton: {
    backgroundColor: '#FC6B36',
    borderRadius: 30,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#FC6B36',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  bookNowButtonDisabled: {
    opacity: 0.6,
  },
  bookNowButtonText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
    cashRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  cashRowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  cashRowText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#0F172A",
    marginLeft: 10,
  },
});
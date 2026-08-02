// components/ServiceCard.tsx
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface ServiceItem {
  id: string;
  name: string;
  base_price: number;
  description?: string;
}

interface ServiceCardProps {
  item: ServiceItem;
  onPress: () => void;
  disabled?: boolean;
  selectedVehicle?: any;
  dynamicPrice?: number | null;
  loading?: boolean;
  priceNote?: string | null;
  // ✅ New: when true, the card shows red "Service Unavailable" text in
  // place of the price/chevron, dims the whole card, and can't be tapped —
  // regardless of what `disabled` is set to. This is distinct from
  // `disabled` (which just mutes styling/interaction for things like an
  // in-flight booking request) — `unavailable` is a longer-lived "this
  // service isn't offered right now" state with its own visual treatment.
  unavailable?: boolean;
}

export const ServiceCard: React.FC<ServiceCardProps> = ({ 
  item, 
  onPress, 
  disabled, 
  selectedVehicle,
  dynamicPrice,
  loading,
  priceNote,
  unavailable,
}) => {
  const displayPrice = dynamicPrice !== null && dynamicPrice !== undefined 
    ? dynamicPrice 
    : item.base_price;
  
  const isPriceDifferent = dynamicPrice && dynamicPrice !== item.base_price;

  return (
    <TouchableOpacity 
      style={[styles.card, (disabled || unavailable) && styles.disabledCard]} 
      onPress={onPress}
      disabled={disabled || loading || unavailable}
    >
      <View style={styles.cardContent}>
        <View style={styles.iconContainer}>
          <Ionicons name="car-outline" size={24} color="#0F172A" />
        </View>
        
        <View style={styles.cardDetails}>
          <Text style={styles.serviceName}>{item.name}</Text>
          {item.description && (
            <Text style={styles.serviceDescription}>{item.description}</Text>
          )}
          
          {selectedVehicle && (
            <View style={styles.vehicleInfoContainer}>
              <Text style={styles.vehicleInfo}>
                For {selectedVehicle.name}
              </Text>
              {priceNote && !unavailable && (
                <Text style={styles.priceNote}>{priceNote}</Text>
              )}
            </View>
          )}
          
          {isPriceDifferent && !unavailable && (
            <View style={styles.priceComparison}>
              <Text style={styles.basePriceStrikethrough}>
                ₹{item.base_price}
              </Text>
              <Text style={styles.savedText}>
                Save ₹{item.base_price - dynamicPrice}
              </Text>
            </View>
          )}
        </View>
        
        <View style={styles.priceContainer}>
          {unavailable ? (
            <Text style={styles.unavailableText}>Currently{"\n"}Unavailable</Text>
          ) : loading ? (
            <ActivityIndicator size="small" color="#0F172A" />
          ) : (
            <>
              <Text style={styles.price}>₹{displayPrice}</Text>
              <Ionicons name="chevron-forward" size={20} color="#64748B" />
            </>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {
    // backgroundColor: "#FFF",
    borderRadius: 12,
    
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  disabledCard: {
    opacity: 0.5,
  },
  cardContent: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconContainer: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F1F5F9",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 12,
  },
  cardDetails: {
    flex: 1,
  },
  serviceName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#0F172A",
    marginBottom: 4,
  },
  serviceDescription: {
    fontSize: 12,
    color: "#64748B",
  },
  vehicleInfoContainer: {
    marginTop: 4,
  },
  vehicleInfo: {
    fontSize: 11,
    color: "#64748B",
  },
  priceNote: {
    fontSize: 10,
    color: "#10B981",
    marginTop: 2,
  },
  priceComparison: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    gap: 8,
  },
  basePriceStrikethrough: {
    fontSize: 11,
    color: "#94A3B8",
    textDecorationLine: "line-through",
  },
  savedText: {
    fontSize: 11,
    color: "#10B981",
    fontWeight: "500",
  },
  priceContainer: {
    alignItems: "flex-end",
    minWidth: 80,
  },
  price: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
    marginBottom: 4,
  },
  // ✅ Red "Service Unavailable" label shown in place of the price/chevron
  unavailableText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#DC2626",
    textAlign: "right",
    lineHeight: 16,
  },
});
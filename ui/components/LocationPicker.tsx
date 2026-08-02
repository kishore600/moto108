// components/LocationPicker.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Modal,
    FlatList,
    ScrollView,
    StyleSheet,
    TextInput,
    Alert,
    ActivityIndicator,
    Platform,
    StatusBar,
    KeyboardAvoidingView,
    Pressable,
} from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '@/lib/api';
import { SavedLocation } from '@/types';

interface LocationPickerProps {
    visible: boolean;
    onClose: () => void;
    onSelectLocation: (location: {
        latitude: number;
        longitude: number;
        address: string;
        isCurrentLocation?: boolean;
        savedLocationId?: string;
    }) => void;
    currentLocation?: {
        latitude: number;
        longitude: number;
        address?: string;
    } | null;
}

interface Suggestion {
    id: string;
    description: string;
    place_id: string;
    structured_formatting?: {
        main_text: string;
        secondary_text: string;
    };
}

// Brand palette — kept identical to tabs/customer.tsx so this screen reads
// as part of the same app instead of a generic default-React-Native form.
const COLORS = {
    teal900: '#063F47',
    teal100: '#E7F1F2',
    teal200: '#BFDBDD',
    orange600: '#EA580C',
    orange50: '#FFF7ED',
    orange100: '#FFEDD5',
    slate50: '#F8FAFC',
    slate100: '#F1F5F9',
    slate200: '#E2E8F0',
    slate400: '#94A3B8',
    slate500: '#64748B',
    slate900: '#0F172A',
    green500: '#10B981',
    green50: '#F0FDF4',
    red500: '#EF4444',
    white: '#FFFFFF',
};

export const LocationPicker: React.FC<LocationPickerProps> = ({
    visible,
    onClose,
    onSelectLocation,
    currentLocation,
}) => {
    const [savedLocations, setSavedLocations] = useState<SavedLocation[]>([]);
    const [loading, setLoading] = useState(true);
    const [showAddForm, setShowAddForm] = useState(false);
    const [newLocationName, setNewLocationName] = useState('');
    const [newLocationAddress, setNewLocationAddress] = useState('');
    const [savingLocation, setSavingLocation] = useState(false);
    const [isGettingCurrentLocation, setIsGettingCurrentLocation] = useState(false);
    const [editingLocation, setEditingLocation] = useState<SavedLocation | null>(null);

    // Autocomplete states
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const [selectedAddressDetails, setSelectedAddressDetails] = useState<{
        lat: number;
        lng: number;
        formatted_address: string;
    } | null>(null);

    const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY;

    // ✅ Real bottom inset (Android 3-button/gesture nav bar, iOS home
    // indicator) instead of a hardcoded 16/28px guess — that guess is what
    // was causing the "Add New Location" pill and the "Cancel / Save
    // Location" row to sit half-covered by the system nav bar.
    const insets = useSafeAreaInsets();
    const bottomPad = Math.max(insets.bottom, 12);

    useEffect(() => {
        if (visible) {
            loadSavedLocations();
        } else {
            // ✅ Reset transient form/search state whenever the sheet is
            // closed, so reopening it never shows a stale "Add Location"
            // form or a leftover suggestions list from the last session.
            setShowAddForm(false);
            setEditingLocation(null);
            setNewLocationName('');
            setNewLocationAddress('');
            setSelectedAddressDetails(null);
            setSuggestions([]);
            setShowSuggestions(false);
        }
        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }
        };
    }, [visible]);

    const loadSavedLocations = async () => {
        setLoading(true);
        try {
            const { data } = await api.get('/location/saved-locations');
            setSavedLocations(data || []);
        } catch (error) {
            console.error('Failed to load saved locations:', error);
            Alert.alert('Error', 'Failed to load saved locations');
        } finally {
            setLoading(false);
        }
    };

    // Google Places Autocomplete with better error handling
    const fetchPlaceSuggestions = async (input: string) => {
        if (!input.trim() || input.length < 3) {
            setSuggestions([]);
            setShowSuggestions(false);
            return;
        }

        if (!GOOGLE_MAPS_API_KEY) {
            console.error('Google Maps API key is missing!');
            Alert.alert('Configuration Error', 'Google Maps API key is not configured');
            return;
        }

        setIsLoadingSuggestions(true);
        try {
            const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
                input
            )}&key=${GOOGLE_MAPS_API_KEY}&components=country:in`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && data.predictions) {
                setSuggestions(
                    data.predictions.map((prediction: any) => ({
                        id: prediction.place_id,
                        description: prediction.description,
                        place_id: prediction.place_id,
                        structured_formatting: prediction.structured_formatting,
                    }))
                );
                setShowSuggestions(true);
            } else if (data.status === 'REQUEST_DENIED') {
                console.error('API Key Error:', data.error_message);
                Alert.alert('API Error', data.error_message || 'Invalid API key');
                setSuggestions([]);
                setShowSuggestions(false);
            } else if (data.status === 'ZERO_RESULTS') {
                setSuggestions([]);
                setShowSuggestions(false);
            } else {
                console.error('Places API error:', data.status, data.error_message);
                setSuggestions([]);
                setShowSuggestions(false);
            }
        } catch (error) {
            console.error('Error fetching suggestions:', error);
            Alert.alert('Network Error', 'Failed to fetch address suggestions');
            setSuggestions([]);
            setShowSuggestions(false);
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    const getPlaceDetails = async (placeId: string) => {
        if (!GOOGLE_MAPS_API_KEY) {
            Alert.alert('Configuration Error', 'Google Maps API key is not configured');
            return;
        }

        setIsLoadingSuggestions(true);
        try {
            const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&key=${GOOGLE_MAPS_API_KEY}&fields=geometry,formatted_address,name`;

            const response = await fetch(url);
            const data = await response.json();

            if (data.status === 'OK' && data.result) {
                const location = data.result.geometry.location;
                const formattedAddress = data.result.formatted_address;

                setSelectedAddressDetails({
                    lat: location.lat,
                    lng: location.lng,
                    formatted_address: formattedAddress,
                });

                setNewLocationAddress(formattedAddress);
                setShowSuggestions(false);
                setSuggestions([]);
            } else if (data.status === 'REQUEST_DENIED') {
                console.error('API Key Error:', data.error_message);
                Alert.alert('API Error', data.error_message || 'Invalid API key');
            } else {
                Alert.alert('Error', 'Failed to get address details');
            }
        } catch (error) {
            console.error('Error getting place details:', error);
            Alert.alert('Error', 'Failed to get address details');
        } finally {
            setIsLoadingSuggestions(false);
        }
    };

    const handleAddressChange = (text: string) => {
        setNewLocationAddress(text);
        setSelectedAddressDetails(null);

        if (debounceTimer.current) {
            clearTimeout(debounceTimer.current);
        }

        debounceTimer.current = setTimeout(() => {
            fetchPlaceSuggestions(text);
        }, 500);
    };

    const handleUseCurrentLocation = async () => {
        setIsGettingCurrentLocation(true);
        try {
            const permission = await Location.requestForegroundPermissionsAsync();
            if (permission.status !== 'granted') {
                Alert.alert('Permission required', 'Please enable location access to use current location.');
                return;
            }

            const location = await Location.getCurrentPositionAsync({
                accuracy: Location.Accuracy.High,
            });

            const addressResponse = await Location.reverseGeocodeAsync({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
            });

            const address = addressResponse[0]
                ? `${addressResponse[0].street || ''} ${addressResponse[0].city || ''} ${addressResponse[0].region || ''}`.trim()
                : 'Current Location';

            onSelectLocation({
                latitude: location.coords.latitude,
                longitude: location.coords.longitude,
                address: address || 'Current Location',
                isCurrentLocation: true,
            });
            onClose();
        } catch (error) {
            Alert.alert('Error', 'Failed to get current location');
        } finally {
            setIsGettingCurrentLocation(false);
        }
    };

    const handleSelectSavedLocation = (location: SavedLocation) => {
        onSelectLocation({
            latitude: location.latitude,
            longitude: location.longitude,
            address: location.address,
            isCurrentLocation: false,
            savedLocationId: location.id,
        });
        onClose();
    };

    const handleSaveNewLocation = async () => {
        if (!newLocationName.trim()) {
            Alert.alert('Error', 'Please enter a location name');
            return;
        }

        if (!selectedAddressDetails && !newLocationAddress.trim()) {
            Alert.alert('Error', 'Please select a valid address from suggestions');
            return;
        }

        setSavingLocation(true);
        try {
            let latitude, longitude, address;

            if (selectedAddressDetails) {
                latitude = selectedAddressDetails.lat;
                longitude = selectedAddressDetails.lng;
                address = selectedAddressDetails.formatted_address;
            } else {
                const geocode = await Location.geocodeAsync(newLocationAddress);
                if (geocode.length === 0) {
                    Alert.alert('Error', 'Could not find coordinates for this address');
                    return;
                }
                latitude = geocode[0].latitude;
                longitude = geocode[0].longitude;
                address = newLocationAddress;
            }

            const { data } = await api.post('/location/saved-locations', {
                name: newLocationName,
                address: address,
                latitude,
                longitude,
                is_default: savedLocations.length === 0,
            });

            setSavedLocations([data, ...savedLocations]);
            setShowAddForm(false);
            setNewLocationName('');
            setNewLocationAddress('');
            setSelectedAddressDetails(null);
            setSuggestions([]);
            Alert.alert('Success', 'Location saved successfully!');
        } catch (error) {
            Alert.alert('Error', 'Failed to save location');
        } finally {
            setSavingLocation(false);
        }
    };

    const handleUpdateLocation = async () => {
        if (!editingLocation) return;

        if (!newLocationName.trim()) {
            Alert.alert('Error', 'Please enter a location name');
            return;
        }

        if (!selectedAddressDetails && !newLocationAddress.trim()) {
            Alert.alert('Error', 'Please select a valid address from suggestions');
            return;
        }

        setSavingLocation(true);
        try {
            let latitude, longitude, address;

            if (selectedAddressDetails) {
                latitude = selectedAddressDetails.lat;
                longitude = selectedAddressDetails.lng;
                address = selectedAddressDetails.formatted_address;
            } else {
                const geocode = await Location.geocodeAsync(newLocationAddress);
                if (geocode.length === 0) {
                    Alert.alert('Error', 'Could not find coordinates for this address');
                    return;
                }
                latitude = geocode[0].latitude;
                longitude = geocode[0].longitude;
                address = newLocationAddress;
            }

            const { data } = await api.put(`/location/saved-locations/${editingLocation.id}`, {
                name: newLocationName,
                address: address,
                latitude,
                longitude,
            });

            setSavedLocations(savedLocations.map(loc =>
                loc.id === editingLocation.id ? data : loc
            ));
            setShowAddForm(false);
            setEditingLocation(null);
            setNewLocationName('');
            setNewLocationAddress('');
            setSelectedAddressDetails(null);
            setSuggestions([]);
            Alert.alert('Success', 'Location updated successfully!');
        } catch (error) {
            Alert.alert('Error', 'Failed to update location');
        } finally {
            setSavingLocation(false);
        }
    };

    const handleDeleteLocation = async (locationId: string) => {
        Alert.alert(
            'Delete Location',
            'Are you sure you want to delete this saved location?',
            [
                { text: 'Cancel', style: 'cancel' },
                {
                    text: 'Delete',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await api.delete(`/location/saved-locations/${locationId}`);
                            setSavedLocations(savedLocations.filter(l => l.id !== locationId));
                        } catch (error) {
                            Alert.alert('Error', 'Failed to delete location');
                        }
                    },
                },
            ]
        );
    };

    const handleSetDefault = async (locationId: string) => {
        try {
            await api.patch(`/location/saved-locations/${locationId}/set-default`, {});
            setSavedLocations(savedLocations.map(loc => ({
                ...loc,
                is_default: loc.id === locationId
            })));
        } catch (error) {
            Alert.alert('Error', 'Failed to set default location');
        }
    };

    const handleEditLocation = (location: SavedLocation) => {
        setEditingLocation(location);
        setNewLocationName(location.name);
        setNewLocationAddress(location.address);
        setSelectedAddressDetails({
            lat: location.latitude,
            lng: location.longitude,
            formatted_address: location.address,
        });
        setShowAddForm(true);
    };

    const renderSuggestion = ({ item }: { item: Suggestion }) => (
        <TouchableOpacity
            style={styles.suggestionItem}
            activeOpacity={0.6}
            onPress={() => getPlaceDetails(item.place_id)}
        >
            <View style={styles.suggestionIconWrap}>
                <Ionicons name="location-outline" size={16} color={COLORS.teal900} />
            </View>
            <View style={styles.suggestionTextContainer}>
                <Text style={styles.suggestionMainText} numberOfLines={1}>
                    {item.structured_formatting?.main_text || item.description}
                </Text>
                {item.structured_formatting?.secondary_text && (
                    <Text style={styles.suggestionSecondaryText} numberOfLines={1}>
                        {item.structured_formatting.secondary_text}
                    </Text>
                )}
            </View>
        </TouchableOpacity>
    );

    const renderLocationItem = ({ item }: { item: SavedLocation }) => (
        <TouchableOpacity
            style={styles.locationItem}
            activeOpacity={0.7}
            onPress={() => handleSelectSavedLocation(item)}
        >
            <View style={styles.locationIcon}>
                <Ionicons name="location" size={20} color={COLORS.teal900} />
            </View>
            <View style={styles.locationInfo}>
                <View style={styles.locationHeader}>
                    <Text style={styles.locationName} numberOfLines={1}>{item.name}</Text>
                    {item.is_default && (
                        <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>Default</Text>
                        </View>
                    )}
                </View>
                <Text style={styles.locationAddress} numberOfLines={2}>
                    {item.address}
                </Text>
            </View>
            <View style={styles.locationActions}>
                <TouchableOpacity
                    onPress={() => handleEditLocation(item)}
                    style={styles.actionButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="pencil-outline" size={16} color={COLORS.slate500} />
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => handleSetDefault(item.id)}
                    style={styles.actionButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons
                        name={item.is_default ? 'star' : 'star-outline'}
                        size={16}
                        color={item.is_default ? COLORS.orange600 : COLORS.slate500}
                    />
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => handleDeleteLocation(item.id)}
                    style={styles.actionButton}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                    <Ionicons name="trash-outline" size={16} color={COLORS.red500} />
                </TouchableOpacity>
            </View>
        </TouchableOpacity>
    );

    return (
        <Modal
            visible={visible}
            animationType="slide"
            transparent={false}
            onRequestClose={onClose}
            statusBarTranslucent
        >
            <View style={styles.container}>
                <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

                {/* Header — matches the teal/white app-bar treatment used
                    elsewhere (avatar circle, rounded touch targets) instead
                    of a plain default header. */}
                <View style={styles.header}>
                    <TouchableOpacity
                        onPress={showAddForm ? () => {
                            setShowAddForm(false);
                            setEditingLocation(null);
                            setNewLocationName('');
                            setNewLocationAddress('');
                            setSelectedAddressDetails(null);
                            setSuggestions([]);
                            setShowSuggestions(false);
                        } : onClose}
                        style={styles.backButton}
                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                        <Ionicons name="arrow-back" size={22} color={COLORS.teal900} />
                    </TouchableOpacity>
                    <Text style={styles.title}>
                        {showAddForm ? (editingLocation ? 'Edit Location' : 'Add Location') : 'Select Location'}
                    </Text>
                    <View style={{ width: 38 }} />
                </View>

                {!showAddForm ? (
                    <>
                        <TouchableOpacity
                            style={styles.currentLocationButton}
                            activeOpacity={0.8}
                            onPress={handleUseCurrentLocation}
                            disabled={isGettingCurrentLocation}
                        >
                            <View style={styles.currentLocationIconWrap}>
                                {isGettingCurrentLocation ? (
                                    <ActivityIndicator color={COLORS.white} size="small" />
                                ) : (
                                    <Ionicons name="navigate" size={20} color={COLORS.white} />
                                )}
                            </View>
                            <View style={styles.currentLocationTextWrap}>
                                <Text style={styles.currentLocationText}>Use Current Location</Text>
                                <Text style={styles.currentLocationHint} numberOfLines={1}>
                                    {isGettingCurrentLocation
                                        ? 'Getting your location…'
                                        : currentLocation?.address || 'GPS location'}
                                </Text>
                            </View>
                            <Ionicons name="chevron-forward" size={18} color={COLORS.slate400} />
                        </TouchableOpacity>

                        <View style={styles.divider}>
                            <View style={styles.dividerLine} />
                            <Text style={styles.dividerText}>SAVED LOCATIONS</Text>
                            <View style={styles.dividerLine} />
                        </View>

                        {loading ? (
                            <ActivityIndicator style={styles.loader} color={COLORS.teal900} />
                        ) : (
                            <FlatList
                                data={savedLocations}
                                keyExtractor={(item) => item.id}
                                renderItem={renderLocationItem}
                                contentContainerStyle={
                                    savedLocations.length === 0 ? styles.listEmptyContainer : styles.listContainer
                                }
                                ListEmptyComponent={
                                    <View style={styles.emptyState}>
                                        <View style={styles.emptyStateIconWrap}>
                                            <Ionicons name="location-outline" size={30} color={COLORS.teal900} />
                                        </View>
                                        <Text style={styles.emptyStateText}>No saved locations yet</Text>
                                        <Text style={styles.emptyStateSubtext}>
                                            Save your favorite places for quick access
                                        </Text>
                                    </View>
                                }
                            />
                        )}

                        <View style={[styles.footer, { paddingBottom: bottomPad + 12 }]}>
                            <TouchableOpacity
                                style={styles.addButton}
                                activeOpacity={0.85}
                                onPress={() => {
                                    setEditingLocation(null);
                                    setNewLocationName('');
                                    setNewLocationAddress('');
                                    setSelectedAddressDetails(null);
                                    setSuggestions([]);
                                    setShowAddForm(true);
                                }}
                            >
                                <Ionicons name="add-circle" size={20} color={COLORS.orange600} />
                                <Text style={styles.addButtonText}>Add New Location</Text>
                            </TouchableOpacity>
                        </View>
                    </>
                ) : (
                    <KeyboardAvoidingView
                        style={styles.flexFill}
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
                    >
                        {/* ✅ Inputs now live in their own scroll area, separate
                            from the button row below. Previously the Cancel/Save
                            row was pinned with marginTop: 'auto' inside the same
                            flexed container as the screen itself, with no bottom
                            safe-area padding — on devices with a gesture bar or
                            3-button nav it sat partly underneath it. */}
                        <ScrollView
                            style={styles.addFormScroll}
                            contentContainerStyle={styles.addForm}
                            keyboardShouldPersistTaps="handled"
                        >
                            <Text style={styles.inputLabel}>Location Name</Text>
                            <TextInput
                                style={styles.input}
                                placeholder="e.g. Home, Work, Garage"
                                placeholderTextColor={COLORS.slate400}
                                value={newLocationName}
                                onChangeText={setNewLocationName}
                            />

                            <Text style={styles.inputLabel}>Address</Text>
                            <View style={styles.addressInputContainer}>
                                <TextInput
                                    style={[styles.input, styles.addressInput]}
                                    placeholder="Start typing for suggestions…"
                                    placeholderTextColor={COLORS.slate400}
                                    value={newLocationAddress}
                                    onChangeText={handleAddressChange}
                                    multiline
                                />
                                {isLoadingSuggestions && (
                                    <ActivityIndicator style={styles.suggestionLoader} color={COLORS.teal900} size="small" />
                                )}
                                {selectedAddressDetails && !isLoadingSuggestions && (
                                    <Ionicons
                                        name="checkmark-circle"
                                        size={20}
                                        color={COLORS.green500}
                                        style={styles.suggestionLoader}
                                    />
                                )}

                                {/* ✅ Rendered as an absolute overlay instead of
                                    inline flow, so the dropdown floats above the
                                    form (and the buttons below it) rather than
                                    pushing everything down the screen. */}
                                {showSuggestions && suggestions.length > 0 && (
                                    <View style={styles.suggestionsOverlay}>
                                        <FlatList
                                            data={suggestions}
                                            keyExtractor={(item) => item.id}
                                            renderItem={renderSuggestion}
                                            keyboardShouldPersistTaps="handled"
                                            style={{ maxHeight: 220 }}
                                        />
                                    </View>
                                )}
                            </View>

                            {selectedAddressDetails && (
                                <View style={styles.selectedLocationPreview}>
                                    <Ionicons name="checkmark-circle" size={18} color={COLORS.green500} />
                                    <Text style={styles.selectedLocationText} numberOfLines={2}>
                                        {selectedAddressDetails.formatted_address}
                                    </Text>
                                </View>
                            )}
                        </ScrollView>

                        {/* ✅ Fixed footer bar, same treatment as the list
                            screen's footer — white background, top border,
                            and padding that always clears the system nav
                            bar / home indicator via bottomPad. */}
                        <View style={[styles.formFooter, { paddingBottom: bottomPad + 12 }]}>
                            <View style={styles.formActions}>
                                <TouchableOpacity
                                    style={[styles.formButton, styles.cancelFormButton]}
                                    activeOpacity={0.8}
                                    onPress={() => {
                                        setShowAddForm(false);
                                        setEditingLocation(null);
                                        setNewLocationName('');
                                        setNewLocationAddress('');
                                        setSelectedAddressDetails(null);
                                        setSuggestions([]);
                                    }}
                                >
                                    <Text style={styles.cancelFormButtonText}>Cancel</Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[
                                        styles.formButton,
                                        styles.saveFormButton,
                                        (savingLocation || (!selectedAddressDetails && !newLocationAddress.trim())) &&
                                            styles.formButtonDisabled,
                                    ]}
                                    activeOpacity={0.85}
                                    onPress={editingLocation ? handleUpdateLocation : handleSaveNewLocation}
                                    disabled={savingLocation || (!selectedAddressDetails && !newLocationAddress.trim())}
                                >
                                    {savingLocation ? (
                                        <ActivityIndicator color={COLORS.white} size="small" />
                                    ) : (
                                        <Text style={styles.saveFormButtonText}>
                                            {editingLocation ? 'Update' : 'Save Location'}
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </KeyboardAvoidingView>
                )}
            </View>
        </Modal>
    );
};

const styles = StyleSheet.create({
    flexFill: { flex: 1 },
    container: {
        flex: 1,
        backgroundColor: COLORS.slate50,
        paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight ?? 24 : 0,
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 12,
        paddingVertical: 14,
        backgroundColor: COLORS.white,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.slate200,
    },
    backButton: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: COLORS.slate100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    title: {
        fontSize: 17,
        fontWeight: '700',
        color: COLORS.teal900,
    },
    currentLocationButton: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.white,
        margin: 16,
        marginBottom: 8,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.teal200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.05,
        shadowRadius: 6,
        elevation: 2,
    },
    currentLocationIconWrap: {
        width: 42,
        height: 42,
        borderRadius: 21,
        backgroundColor: COLORS.teal900,
        justifyContent: 'center',
        alignItems: 'center',
    },
    currentLocationTextWrap: {
        flex: 1,
        marginLeft: 12,
    },
    currentLocationText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.teal900,
    },
    currentLocationHint: {
        fontSize: 12,
        color: COLORS.slate500,
        marginTop: 2,
    },
    divider: {
        flexDirection: 'row',
        alignItems: 'center',
        marginHorizontal: 16,
        marginTop: 18,
        marginBottom: 10,
    },
    dividerLine: {
        flex: 1,
        height: 1,
        backgroundColor: COLORS.slate200,
    },
    dividerText: {
        marginHorizontal: 10,
        color: COLORS.slate400,
        fontSize: 11,
        fontWeight: '700',
        letterSpacing: 0.6,
    },
    listContainer: {
        paddingHorizontal: 16,
        paddingBottom: 8,
    },
    listEmptyContainer: {
        flexGrow: 1,
    },
    locationItem: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: COLORS.white,
        marginBottom: 10,
        padding: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: COLORS.slate200,
    },
    locationIcon: {
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: COLORS.teal100,
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 12,
    },
    locationInfo: {
        flex: 1,
        marginRight: 8,
    },
    locationHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 3,
    },
    locationName: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.teal900,
        marginRight: 8,
        flexShrink: 1,
    },
    defaultBadge: {
        backgroundColor: COLORS.orange100,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 8,
    },
    defaultBadgeText: {
        color: COLORS.orange600,
        fontSize: 10,
        fontWeight: '700',
    },
    locationAddress: {
        fontSize: 13,
        color: COLORS.slate500,
        lineHeight: 18,
    },
    locationActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 2,
    },
    actionButton: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: COLORS.slate100,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 4,
    },
    loader: {
        marginTop: 40,
    },
    emptyState: {
        alignItems: 'center',
        justifyContent: 'center',
        flexGrow: 1,
        paddingHorizontal: 32,
    },
    emptyStateIconWrap: {
        width: 64,
        height: 64,
        borderRadius: 32,
        backgroundColor: COLORS.teal100,
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 14,
    },
    emptyStateText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.teal900,
    },
    emptyStateSubtext: {
        fontSize: 13,
        color: COLORS.slate500,
        marginTop: 6,
        textAlign: 'center',
    },
    footer: {
        padding: 16,
        paddingBottom: Platform.OS === 'ios' ? 28 : 16,
        backgroundColor: COLORS.slate50,
        borderTopWidth: 1,
        borderTopColor: COLORS.slate200,
    },
    addButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 15,
        backgroundColor: COLORS.orange50,
        borderRadius: 14,
        borderWidth: 1.5,
        borderColor: COLORS.orange600,
        borderStyle: 'dashed',
    },
    addButtonText: {
        fontSize: 15,
        fontWeight: '700',
        color: COLORS.orange600,
        marginLeft: 8,
    },
    addFormScroll: {
        flex: 1,
    },
    addForm: {
        padding: 16,
        paddingBottom: 24,
    },
    formFooter: {
        paddingHorizontal: 16,
        paddingTop: 12,
        backgroundColor: COLORS.white,
        borderTopWidth: 1,
        borderTopColor: COLORS.slate200,
    },
    inputLabel: {
        fontSize: 12,
        fontWeight: '700',
        color: COLORS.slate500,
        marginBottom: 6,
        textTransform: 'uppercase',
        letterSpacing: 0.4,
    },
    input: {
        backgroundColor: COLORS.white,
        borderRadius: 12,
        padding: 13,
        marginBottom: 16,
        borderWidth: 1.5,
        borderColor: COLORS.slate200,
        fontSize: 15,
        color: COLORS.teal900,
    },
    addressInputContainer: {
        position: 'relative',
        zIndex: 10,
    },
    addressInput: {
        minHeight: 72,
        textAlignVertical: 'top',
        paddingRight: 40,
    },
    suggestionLoader: {
        position: 'absolute',
        right: 12,
        top: 14,
    },
    suggestionsOverlay: {
        position: 'absolute',
        top: 74,
        left: 0,
        right: 0,
        backgroundColor: COLORS.white,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: COLORS.slate200,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.12,
        shadowRadius: 10,
        elevation: 8,
        zIndex: 20,
        overflow: 'hidden',
    },
    suggestionItem: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 12,
        borderBottomWidth: 1,
        borderBottomColor: COLORS.slate100,
    },
    suggestionIconWrap: {
        width: 30,
        height: 30,
        borderRadius: 15,
        backgroundColor: COLORS.teal100,
        justifyContent: 'center',
        alignItems: 'center',
    },
    suggestionTextContainer: {
        marginLeft: 10,
        flex: 1,
    },
    suggestionMainText: {
        fontSize: 14,
        fontWeight: '600',
        color: COLORS.teal900,
    },
    suggestionSecondaryText: {
        fontSize: 12,
        color: COLORS.slate500,
        marginTop: 2,
    },
    selectedLocationPreview: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        backgroundColor: COLORS.green50,
        padding: 12,
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        borderColor: '#BBF7D0',
    },
    selectedLocationText: {
        marginLeft: 8,
        fontSize: 13,
        color: '#065F46',
        fontWeight: '600',
        flex: 1,
        lineHeight: 18,
    },
    formActions: {
        flexDirection: 'row',
    },
    formButton: {
        flex: 1,
        paddingVertical: 15,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
    },
    cancelFormButton: {
        backgroundColor: COLORS.white,
        borderWidth: 1.5,
        borderColor: COLORS.slate200,
        marginRight: 8,
    },
    cancelFormButtonText: {
        color: COLORS.slate500,
        fontSize: 15,
        fontWeight: '700',
    },
    saveFormButton: {
        backgroundColor: COLORS.teal900,
        marginLeft: 8,
        shadowColor: COLORS.teal900,
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.25,
        shadowRadius: 8,
        elevation: 4,
    },
    formButtonDisabled: {
        opacity: 0.5,
    },
    saveFormButtonText: {
        color: COLORS.white,
        fontSize: 15,
        fontWeight: '700',
    },
});
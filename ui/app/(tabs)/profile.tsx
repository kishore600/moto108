/* eslint-disable react/no-unescaped-entities */
// app/(customer)/profile.tsx
import { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  TextInput,
  Modal,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

interface UserProfile {
  id: string;
  full_name: string;
  email: string;
  phone: string;
  avatar_url?: string;
  created_at: string;
}

interface UserStats {
  totalServicesDone: number;
  totalRatingsGiven: number;
  totalSavedLocations: number;
}

// Adjust to match the height of your bottom tab bar so content never
// gets hidden behind it.
const TAB_BAR_CLEARANCE = 90;

export default function ProfileScreen() {
  const { user, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [stats, setStats] = useState<UserStats>({
    totalServicesDone: 0,
    totalRatingsGiven: 0,
    totalSavedLocations: 0,
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', phone: '' });
  const [updating, setUpdating] = useState(false);

  // Change Password Modal States
  const [changePasswordModalVisible, setChangePasswordModalVisible] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [changingPassword, setChangingPassword] = useState(false);

  useEffect(() => {
    loadAllData();
  }, []);

  const loadAllData = async () => {
    setLoading(true);
    await Promise.all([loadProfileData(), loadStats()]);
    setLoading(false);
  };

  const loadProfileData = async () => {
    try {
      const { data } = await api.get('/profile/me');
      setProfile(data);
      setEditForm({
        full_name: data.full_name || '',
        phone: data.phone || '',
      });
    } catch (error) {
      console.error('Failed to load profile:', error);
    }
  };

  const loadStats = async () => {
    try {
      if (!user?.id) return;
      const { data } = await api.get(`/profile/${user?.id}/stats`);
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadAllData();
    setRefreshing(false);
  }, []);

  const handleUpdateProfile = async () => {
    if (!editForm.full_name.trim()) {
      Alert.alert('Error', 'Name cannot be empty');
      return;
    }

    if (editForm.phone && !/^[0-9+\-\s()]{10,15}$/.test(editForm.phone)) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setUpdating(true);
    try {
      await api.patch(`/profile/${user?.id}`, {
        full_name: editForm.full_name,
        phone: editForm.phone,
      });
      await loadProfileData();
      setEditModalVisible(false);
      Alert.alert('Success', 'Profile updated successfully');
    } catch (error: any) {
      console.log(error);
      Alert.alert('Error', error.response?.data?.error || 'Failed to update profile');
    } finally {
      setUpdating(false);
    }
  };

  const handleChangePassword = async () => {
    if (!passwordForm.current_password) {
      Alert.alert('Error', 'Please enter your current password');
      return;
    }

    if (!passwordForm.new_password) {
      Alert.alert('Error', 'Please enter a new password');
      return;
    }

    if (passwordForm.new_password.length < 6) {
      Alert.alert('Error', 'New password must be at least 6 characters');
      return;
    }

    if (passwordForm.new_password !== passwordForm.confirm_password) {
      Alert.alert('Error', 'New passwords do not match');
      return;
    }

    setChangingPassword(true);
    try {
      await api.post('/profile/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password,
      });

      Alert.alert('Success', 'Password changed successfully');
      setChangePasswordModalVisible(false);
      setPasswordForm({
        current_password: '',
        new_password: '',
        confirm_password: '',
      });
    } catch (error: any) {
      Alert.alert('Error', error.response?.data?.error || 'Failed to change password');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleDeleteAccount = () => {
    Alert.alert(
      'Delete Account',
      'Are you sure you want to delete your account? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            try {
              await api.delete(`/profile/${user?.id}`);
              await logout();
              router.replace('/(auth)/login');
            } catch (error: any) {
              Alert.alert('Error', error.response?.data?.error || 'Failed to delete account');
            }
          },
        },
      ],
    );
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        onPress: async () => {
          try {
            await logout();
          } catch (error) {
            await logout();
          }
        },
      },
    ]);
  };

  const initial =
    profile?.full_name?.charAt(0) || user?.full_name?.charAt(0) || 'U';

  const renderOverview = () => (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={styles.scrollContent}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={['#0F172A']}
          tintColor="#0F172A"
        />
      }
    >
      {/* Profile Header */}
      <View style={styles.profileHeader}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initial.toUpperCase()}</Text>
          </View>
          <TouchableOpacity
            style={styles.editAvatarButton}
            onPress={() => Alert.alert('Coming Soon', 'Photo upload will be available soon')}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Ionicons name="camera" size={14} color="#FFF" />
          </TouchableOpacity>
        </View>

        <Text style={styles.userName} numberOfLines={1}>
          {profile?.full_name || user?.full_name}
        </Text>
        <Text style={styles.userEmail} numberOfLines={1}>
          {profile?.email || user?.email}
        </Text>
        {!!profile?.phone && <Text style={styles.userPhone}>{profile.phone}</Text>}

        <TouchableOpacity
          style={styles.editProfileButton}
          onPress={() => setEditModalVisible(true)}
        >
          <Ionicons name="create-outline" size={16} color="#0F172A" />
          <Text style={styles.editProfileText}>Edit Profile</Text>
        </TouchableOpacity>
      </View>

      {/* Stats Cards */}
      <View style={styles.statsContainer}>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: '#EFF6FF' }]}>
            <Ionicons name="calendar" size={20} color="#3B82F6" />
          </View>
          <Text style={styles.statNumber}>{stats.totalServicesDone}</Text>
          <Text style={styles.statLabel}>Services Done</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: '#FFFBEB' }]}>
            <Ionicons name="star" size={20} color="#FBBF24" />
          </View>
          <Text style={styles.statNumber}>{stats.totalRatingsGiven}</Text>
          <Text style={styles.statLabel}>Ratings Given</Text>
        </View>
        <View style={styles.statCard}>
          <View style={[styles.statIconWrap, { backgroundColor: '#F0FDF4' }]}>
            <Ionicons name="location" size={20} color="#10B981" />
          </View>
          <Text style={styles.statNumber}>{stats.totalSavedLocations}</Text>
          <Text style={styles.statLabel}>Saved Places</Text>
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Quick Actions</Text>
        <TouchableOpacity style={styles.actionItem}>
          <View style={styles.actionIconWrap}>
            <Ionicons name="headset-outline" size={18} color="#0F172A" />
          </View>
          <Text style={styles.actionText}>Support & Help</Text>
          <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* Account Settings */}
      <View style={[styles.section, styles.lastSection]}>
        <Text style={styles.sectionTitle}>Account Settings</Text>

        <TouchableOpacity
          style={styles.actionItem}
          onPress={() => setChangePasswordModalVisible(true)}
        >
          <View style={styles.actionIconWrap}>
            <Ionicons name="key-outline" size={18} color="#0F172A" />
          </View>
          <Text style={styles.actionText}>Change Password</Text>
          <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionItem} onPress={handleLogout}>
          <View style={[styles.actionIconWrap, styles.actionIconWrapDanger]}>
            <Ionicons name="log-out-outline" size={18} color="#EF4444" />
          </View>
          <Text style={[styles.actionText, styles.actionTextDanger]}>Logout</Text>
          <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.actionItem, styles.actionItemLast]}
          onPress={handleDeleteAccount}
        >
          <View style={[styles.actionIconWrap, styles.actionIconWrapDanger]}>
            <Ionicons name="trash-outline" size={18} color="#EF4444" />
          </View>
          <Text style={[styles.actionText, styles.actionTextDanger]}>Delete Account</Text>
          <Ionicons name="chevron-forward" size={18} color="#94A3B8" />
        </TouchableOpacity>
      </View>
    </ScrollView>
  );

  // Change Password Modal
  const renderChangePasswordModal = () => (
    <Modal
      visible={changePasswordModalVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setChangePasswordModalVisible(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.editModalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Change Password</Text>
            <TouchableOpacity
              onPress={() => setChangePasswordModalVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.editFormScroll}
            contentContainerStyle={styles.editForm}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Current Password</Text>
              <TextInput
                style={styles.input}
                value={passwordForm.current_password}
                onChangeText={(text) =>
                  setPasswordForm({ ...passwordForm, current_password: text })
                }
                placeholder="Enter current password"
                placeholderTextColor="#94A3B8"
                secureTextEntry
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>New Password</Text>
              <TextInput
                style={styles.input}
                value={passwordForm.new_password}
                onChangeText={(text) =>
                  setPasswordForm({ ...passwordForm, new_password: text })
                }
                placeholder="Enter new password (min 6 characters)"
                placeholderTextColor="#94A3B8"
                secureTextEntry
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Confirm New Password</Text>
              <TextInput
                style={styles.input}
                value={passwordForm.confirm_password}
                onChangeText={(text) =>
                  setPasswordForm({ ...passwordForm, confirm_password: text })
                }
                placeholder="Confirm new password"
                placeholderTextColor="#94A3B8"
                secureTextEntry
              />
            </View>

            <TouchableOpacity
              style={[styles.saveButton, changingPassword && styles.disabledButton]}
              onPress={handleChangePassword}
              disabled={changingPassword}
            >
              {changingPassword ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.saveButtonText}>Change Password</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  // Edit Profile Modal
  const renderEditProfileModal = () => (
    <Modal
      visible={editModalVisible}
      animationType="slide"
      transparent={true}
      onRequestClose={() => setEditModalVisible(false)}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.editModalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Edit Profile</Text>
            <TouchableOpacity
              onPress={() => setEditModalVisible(false)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={22} color="#64748B" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.editFormScroll}
            contentContainerStyle={styles.editForm}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Full Name</Text>
              <TextInput
                style={styles.input}
                value={editForm.full_name}
                onChangeText={(text) => setEditForm({ ...editForm, full_name: text })}
                placeholder="Enter your full name"
                placeholderTextColor="#94A3B8"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={editForm.phone}
                onChangeText={(text) => setEditForm({ ...editForm, phone: text })}
                placeholder="Enter your phone number"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Email</Text>
              <TextInput
                style={[styles.input, styles.disabledInput]}
                value={profile?.email || user?.email}
                editable={false}
              />
              <Text style={styles.inputHint}>Email cannot be changed</Text>
            </View>

            <TouchableOpacity
              style={[styles.saveButton, updating && styles.disabledButton]}
              onPress={handleUpdateProfile}
              disabled={updating}
            >
              {updating ? (
                <ActivityIndicator color="#FFF" size="small" />
              ) : (
                <Text style={styles.saveButtonText}>Save Changes</Text>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#0F172A" />
          <Text style={styles.loadingText}>Loading profile...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Fixed header — sits above the scroll content, never overlaps it */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Profile</Text>
      </View>

      {renderOverview()}
      {renderEditProfileModal()}
      {renderChangePasswordModal()}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#64748B',
  },

  // --- Fixed header ---
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    zIndex: 10,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
  },

  // --- Scroll content ---
  scrollContent: {
    paddingBottom: TAB_BAR_CLEARANCE,
    flexGrow: 1,
  },

  profileHeader: {
    alignItems: 'center',
    paddingVertical: 24,
    paddingHorizontal: 20,
    backgroundColor: '#FFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 16,
  },
  avatar: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 36,
    fontWeight: '700',
    color: '#FFF',
  },
  editAvatarButton: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: '#0F172A',
    width: 30,
    height: 30,
    borderRadius: 15,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFF',
  },
  userName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 4,
    maxWidth: '100%',
  },
  userEmail: {
    fontSize: 14,
    color: '#64748B',
    marginBottom: 2,
    maxWidth: '100%',
  },
  userPhone: {
    fontSize: 14,
    color: '#64748B',
  },
  editProfileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 20,
    backgroundColor: '#F1F5F9',
  },
  editProfileText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },

  // --- Stats ---
  statsContainer: {
    flexDirection: 'row',
    padding: 16,
    gap: 12,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#FFF',
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 8,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  statIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 8,
  },
  statLabel: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
    textAlign: 'center',
  },

  // --- Sections ---
  section: {
    backgroundColor: '#FFF',
    marginTop: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  lastSection: {
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 12,
  },
  actionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    gap: 12,
  },
  actionItemLast: {
    borderBottomWidth: 0,
    paddingBottom: 0,
  },
  actionIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionIconWrapDanger: {
    backgroundColor: '#FEF2F2',
  },
  actionText: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
  },
  actionTextDanger: {
    color: '#EF4444',
  },

  // --- Modals ---
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  editModalContent: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0F172A',
  },
  editFormScroll: {
    flexGrow: 0,
  },
  editForm: {
    padding: 20,
  },
  inputGroup: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: '#0F172A',
  },
  disabledInput: {
    backgroundColor: '#F8FAFC',
    color: '#94A3B8',
  },
  inputHint: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 4,
  },
  saveButton: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    marginTop: 4,
  },
  saveButtonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  disabledButton: {
    opacity: 0.6,
  },
});
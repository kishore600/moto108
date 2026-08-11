import React, { createContext, useContext, useState, useEffect } from 'react';
import { api } from '@/lib/api';
import { router } from 'expo-router';
import { Alert } from 'react-native';
import * as SecureStore from 'expo-secure-store';

interface User {
  id: string;
  email: string;
  full_name: string;
  role: 'customer' | 'mechanic';
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  logout: () => Promise<void>;
  checkSession: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkSession();
  }, []); // Only run once on mount

  async function checkSession() {
    try {
      // Check for stored token and user data in SecureStore
      let token = await SecureStore.getItemAsync('auth_token');
      let userData = await SecureStore.getItemAsync('user');

      // Migrate sessions written by older builds under the legacy key names
      if (!token || !userData) {
        const legacyToken = await SecureStore.getItemAsync('token');
        const legacyUserData = await SecureStore.getItemAsync('user_data');
        if (legacyToken && legacyUserData) {
          token = legacyToken;
          userData = legacyUserData;
          await SecureStore.setItemAsync('auth_token', legacyToken);
          await SecureStore.setItemAsync('user', legacyUserData);
          await SecureStore.deleteItemAsync('token');
          await SecureStore.deleteItemAsync('user_data');
        }
      }

      console.log('Token exists:', !!token, userData);

      if (token && userData) {
        const parsedUser = JSON.parse(userData);
        setUser(parsedUser);
        
        // Set token in API client for subsequent requests
        api.setToken(token);
        if (parsedUser.role === 'mechanic') {
          router.replace('/mechanic/dashboard');
        } else if (parsedUser.role === 'customer') {
          router.replace('/(tabs)/customer');
        } else {
          router.replace('/(auth)/login');
        }
        console.log('Session restored successfully');
      }
    } catch (error) {
      console.error('Session check failed:', error);
      await clearSession();
    } finally {
      setIsLoading(false);
    }
  }

  async function clearSession() {
    await SecureStore.deleteItemAsync('auth_token');
    await SecureStore.deleteItemAsync('user');
    await SecureStore.deleteItemAsync('token');
    await SecureStore.deleteItemAsync('user_data');
    api.clearToken();
    setUser(null);
  }

  async function logout() {
    Alert.alert(
      'Logout',
      'Are you sure you want to logout?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await clearSession();
            router.replace('/');
            Alert.alert('Logged Out', 'You have been logged out successfully.');
          }
        }
      ]
    );
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, logout, checkSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
// app/(auth)/login.tsx
import { useState, useEffect } from 'react';
import { 
  View, Text, TextInput, TouchableOpacity, StyleSheet, 
  SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator, 
  Alert 
} from 'react-native';
import { router, Link } from 'expo-router';
import { api } from '@/lib/api';

// Already-logged-in users are redirected by AuthContext.checkSession()
// at app boot (see app/_layout.tsx), so this screen doesn't duplicate that check.
export default function LoginScreen() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  // Send OTP for login
  async function handleSendOTP() {
    if (!phone) {
      Alert.alert('Error', 'Please enter your phone number');
      return;
    }

    // Basic phone validation
    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(phone.replace(/[^0-9]/g, ''))) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    setOtpLoading(true);
    try {
      const { data } = await api.post('/auth/send-otp', { phone });

      if (data.success) {
        setOtp('');
        setOtpSent(true);
        setCountdown(60);
        Alert.alert('Success', 'OTP sent successfully!');
        if (data.devOtp) {
          Alert.alert('Development OTP', `Your OTP is: ${data.devOtp}`);
        }
      } else {
        Alert.alert('Error', data.error || 'Failed to send OTP');
      }
    } catch (error: any) {
      console.error('Send OTP error:', error);
      Alert.alert('Error', error.message || 'Failed to send OTP');
    } finally {
      setOtpLoading(false);
    }
  }

  // Verify OTP and login
  async function handleVerifyOTP() {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-otp', { phone, otp });
      
      if (data.success) {
        await api.setToken(data.token);
        await api.setUser(data.user);

        if (data.user.role === 'mechanic') {
          router.replace('/mechanic/dashboard');
        } else {
          router.replace('/(tabs)/customer');
        }
      } else {
        Alert.alert('Login Failed', data.error || 'Invalid OTP');
      }
    } catch (error: any) {
      console.error('Verify OTP error:', error);
      Alert.alert('Error', error.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  function resetOTPFlow() {
    setOtpSent(false);
    setOtp('');
    setCountdown(0);
  }

  function formatPhoneNumber(text: string) {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length <= 10) return cleaned;
    return cleaned.slice(0, 15);
  }

  // Auto-submit OTP when 6 digits are entered
  useEffect(() => {
    if (otp.length === 6 && otpSent) {
      handleVerifyOTP();
    }
  }, [otp]);

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <View style={styles.content}>
          <View style={styles.logoContainer}>
            <Text style={styles.logo}>🚗</Text>
            <Text style={styles.title}>Welcome Back</Text>
            <Text style={styles.subtitle}>Login with your phone number</Text>
          </View>

          <View style={styles.form}>
            {!otpSent ? (
              // Phone number input
              <>
                <TextInput
                  style={styles.input}
                  placeholder="Phone Number"
                  placeholderTextColor="#94A3B8"
                  value={phone}
                  onChangeText={(text) => setPhone(formatPhoneNumber(text))}
                  keyboardType="phone-pad"
                  editable={!otpLoading}
                  returnKeyType="done"
                  onSubmitEditing={handleSendOTP}
                />
                
                <TouchableOpacity 
                  style={[styles.button, otpLoading && styles.buttonDisabled]} 
                  onPress={handleSendOTP}
                  disabled={otpLoading}
                >
                  {otpLoading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.buttonText}>Send OTP</Text>
                  )}
                </TouchableOpacity>
              </>
            ) : (
              // OTP verification
              <>
                <View style={styles.otpHeader}>
                  <Text style={styles.otpText}>
                    OTP sent to {phone}
                  </Text>
                  <TouchableOpacity onPress={resetOTPFlow}>
                    <Text style={styles.editLink}>Edit</Text>
                  </TouchableOpacity>
                </View>

                <TextInput
                  style={[styles.input, styles.otpInput]}
                  placeholder="Enter 6-digit OTP"
                  placeholderTextColor="#94A3B8"
                  value={otp}
                  onChangeText={setOtp}
                  keyboardType="number-pad"
                  maxLength={6}
                  editable={!loading}
                  returnKeyType="done"
                  onSubmitEditing={handleVerifyOTP}
                  autoFocus={true}
                />

                <TouchableOpacity 
                  style={[styles.button, loading && styles.buttonDisabled]} 
                  onPress={handleVerifyOTP}
                  disabled={loading}
                >
                  {loading ? (
                    <ActivityIndicator color="#FFF" />
                  ) : (
                    <Text style={styles.buttonText}>Verify & Login</Text>
                  )}
                </TouchableOpacity>

                {countdown > 0 ? (
                  <Text style={styles.resendText}>
                    Resend OTP in {countdown}s
                  </Text>
                ) : (
                  <TouchableOpacity onPress={handleSendOTP}>
                    <Text style={styles.resendLink}>Resend OTP</Text>
                  </TouchableOpacity>
                )}
              </>
            )}

            <View style={styles.footer}>
              <Text style={styles.footerText}>Don&lsquo;t have an account? </Text>
              <Link href="/(auth)/signup" asChild>
                <TouchableOpacity>
                  <Text style={styles.link}>Sign Up</Text>
                </TouchableOpacity>
              </Link>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  keyboardView: { flex: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  logoContainer: { alignItems: 'center', marginBottom: 32 },
  logo: { fontSize: 64, marginBottom: 16 },
  title: { fontSize: 32, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B' },
  
  form: { gap: 16 },
  input: {
    backgroundColor: '#FFF',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    color: '#0F172A',
  },
  otpInput: {
    textAlign: 'center',
    fontSize: 20,
    letterSpacing: 8,
    fontWeight: '600',
  },
  button: {
    backgroundColor: '#0F172A',
    padding: 16,
    borderRadius: 12,
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
  
  otpHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  otpText: {
    fontSize: 14,
    color: '#64748B',
  },
  editLink: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
  },
  resendText: {
    textAlign: 'center',
    fontSize: 14,
    color: '#94A3B8',
    marginTop: 8,
  },
  resendLink: {
    textAlign: 'center',
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
    marginTop: 8,
  },
  
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 24,
  },
  footerText: {
    color: '#64748B',
    fontSize: 14,
  },
  link: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '600',
  },
});
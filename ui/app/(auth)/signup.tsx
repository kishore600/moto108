// app/(auth)/signup.tsx
import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert } from 'react-native';
import { router, Link } from 'expo-router';
import { api } from '@/lib/api';

// Already-logged-in users are redirected by AuthContext.checkSession()
// at app boot (see app/_layout.tsx), so this screen doesn't duplicate that check.
export default function SignupScreen() {
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState<'customer' | 'mechanic'>('customer');
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [step, setStep] = useState<'details' | 'otp'>('details');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (countdown > 0) {
      timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    }
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (otp.length === 6 && otpSent) {
      handleVerifyOTP();
    }
  }, [otp]);

  async function handleSendOTP() {
    // Only validate phone and name (email is optional)
    if (!fullName) {
      Alert.alert('Error', 'Please enter your full name');
      return;
    }

    const phoneRegex = /^[0-9]{10,15}$/;
    if (!phoneRegex.test(phone.replace(/[^0-9]/g, ''))) {
      Alert.alert('Error', 'Please enter a valid phone number');
      return;
    }

    // Optional email validation (only if provided)
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        Alert.alert('Error', 'Please enter a valid email address');
        return;
      }
    }

    setOtpLoading(true);
    try {
      const { data } = await api.post('/auth/send-signup-otp', { phone });

      if (data.success) {
        setOtp('');
        setOtpSent(true);
        setStep('otp');
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

  async function handleVerifyOTP() {
    if (!otp || otp.length !== 6) {
      Alert.alert('Error', 'Please enter a valid 6-digit OTP');
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.post('/auth/verify-signup-otp', {
        phone,
        otp,
        email: email || null, // Send null if not provided
        fullName,
        role
      });
      
      if (data.success) {
        await api.setToken(data.token);
        await api.setUser(data.user);

        if (data.user.role === 'mechanic') {
          router.replace('/mechanic/dashboard');
        } else {
          router.replace('/(tabs)/customer');
        }
      } else {
        Alert.alert('Signup Failed', data.error || 'Invalid OTP');
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
    setStep('details');
  }

  function formatPhoneNumber(text: string) {
    const cleaned = text.replace(/[^0-9]/g, '');
    if (cleaned.length <= 10) return cleaned;
    return cleaned.slice(0, 15);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView 
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.keyboardView}
      >
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <View style={styles.content}>
            <Text style={styles.title}>Create Account</Text>
            <Text style={styles.subtitle}>Sign up with your phone number</Text>

            <View style={styles.form}>
              {step === 'details' ? (
                // Registration Details
                <>
                  <TextInput
                    style={styles.input}
                    placeholder="Full Name *"
                    placeholderTextColor="#94A3B8"
                    value={fullName}
                    onChangeText={setFullName}
                    editable={!otpLoading}
                  />

                  <TextInput
                    style={styles.input}
                    placeholder="Phone Number *"
                    placeholderTextColor="#94A3B8"
                    value={phone}
                    onChangeText={(text) => setPhone(formatPhoneNumber(text))}
                    keyboardType="phone-pad"
                    editable={!otpLoading}
                  />

                  <View style={styles.optionalSection}>
                    <Text style={styles.optionalLabel}>Optional Information</Text>
                    <Text style={styles.optionalHint}>You can skip this if you prefer</Text>
                  </View>

                  <TextInput
                    style={styles.input}
                    placeholder="Email (Optional)"
                    placeholderTextColor="#94A3B8"
                    value={email}
                    onChangeText={setEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    editable={!otpLoading}
                  />

                  <View style={styles.roleContainer}>
                    <Text style={styles.roleLabel}>I am a:</Text>
                    <View style={styles.roleButtons}>
                      <TouchableOpacity
                        style={[styles.roleButton, role === 'customer' && styles.roleButtonActive]}
                        onPress={() => setRole('customer')}
                        disabled={otpLoading}
                      >
                        <Text style={[styles.roleText, role === 'customer' && styles.roleTextActive]}>
                          Customer
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.roleButton, role === 'mechanic' && styles.roleButtonActive]}
                        onPress={() => setRole('mechanic')}
                        disabled={otpLoading}
                      >
                        <Text style={[styles.roleText, role === 'mechanic' && styles.roleTextActive]}>
                          Mechanic
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>

                  <TouchableOpacity 
                    style={[styles.button, otpLoading && styles.buttonDisabled]} 
                    onPress={handleSendOTP}
                    disabled={otpLoading}
                  >
                    {otpLoading ? (
                      <ActivityIndicator color="#FFF" />
                    ) : (
                      <Text style={styles.buttonText}>Verify Phone</Text>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                // OTP Verification
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
                      <Text style={styles.buttonText}>Verify & Create Account</Text>
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
                <Text style={styles.footerText}>Already have an account? </Text>
                <Link href="/(auth)/login" asChild>
                  <TouchableOpacity>
                    <Text style={styles.link}>Login</Text>
                  </TouchableOpacity>
                </Link>
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  keyboardView: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#64748B', marginBottom: 32 },
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
  optionalSection: {
    marginTop: 8,
    marginBottom: 4,
  },
  optionalLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  optionalHint: {
    fontSize: 12,
    color: '#94A3B8',
    marginTop: 2,
  },
  roleContainer: {
    gap: 8,
  },
  roleLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  roleButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  roleButton: {
    flex: 1,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFF',
    alignItems: 'center',
  },
  roleButtonActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  roleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  roleTextActive: {
    color: '#FFF',
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
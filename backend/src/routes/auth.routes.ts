// routes/auth.ts
import { Router } from 'express';
import { supabaseAdmin } from '../config/supabase';
import { signToken } from '../utils/jwt';
import { twilioClient } from '../config/twilio';

const router = Router();

// Store OTPs temporarily (use Redis in production)
const otpStore = new Map();

// Send OTP for login
router.post('/send-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Format phone number
    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      formattedPhone = `+91${phone}`;
    }

    // Check if user exists
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role, phone')
      .eq('phone', formattedPhone)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'Phone number not registered. Please sign up first.' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Store OTP with expiration (5 minutes)
    otpStore.set(formattedPhone, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      userId: user.id
    });

    try {
      // Send SMS via Twilio
      await twilioClient.messages.create({
        body: `Your login verification code is: ${otp}. This code will expire in 5 minutes.`,
        to: formattedPhone,
        from: process.env.TWILIO_PHONE_NUMBER
      });

      res.json({ 
        success: true, 
        message: 'OTP sent successfully'
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);

      // Fallback for development only — never leak the real OTP in production
      res.json({
        success: true,
        message: 'OTP sent successfully',
        ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
      });
    }

  } catch (err: any) {
    console.error('Send OTP error:', err);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
});

// Verify OTP and login
router.post('/verify-otp', async (req, res) => {
  try {
    const { phone, otp } = req.body;

    if (!phone || !otp) {
      return res.status(400).json({ error: 'Phone and OTP are required' });
    }

    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      formattedPhone = `+91${phone}`;
    }

    const storedData = otpStore.get(formattedPhone);
    
    if (!storedData) {
      return res.status(400).json({ error: 'OTP expired or not requested' });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(formattedPhone);
      return res.status(400).json({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Get user data
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, full_name, role, phone')
      .eq('phone', formattedPhone)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    otpStore.delete(formattedPhone);

    const token = signToken({ id: user.id, role: user.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ 
      success: true,
      token,
      user 
    });

  } catch (err: any) {
    console.error('Verify OTP error:', err);
    res.status(500).json({ error: err.message || 'OTP verification failed' });
  }
});

// Send OTP for signup
router.post('/send-signup-otp', async (req, res) => {
  try {
    const { phone } = req.body;
    
    if (!phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      formattedPhone = `+91${phone}`;
    }

    // Check if phone already registered
    const { data: existingUser } = await supabaseAdmin
      .from('profiles')
      .select('phone')
      .eq('phone', formattedPhone)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Phone number already registered' });
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    otpStore.set(`signup_${formattedPhone}`, {
      otp,
      expiresAt: Date.now() + 5 * 60 * 1000,
      phone: formattedPhone
    });

    try {
      await twilioClient.messages.create({
        body: `Your registration verification code is: ${otp}. This code will expire in 5 minutes.`,
        to: formattedPhone,
        from: process.env.TWILIO_PHONE_NUMBER
      });

      res.json({
        success: true,
        message: 'OTP sent successfully'
      });
    } catch (twilioError) {
      console.error('Twilio error:', twilioError);

      // Fallback for development only — never leak the real OTP in production
      res.json({
        success: true,
        message: 'OTP sent successfully',
        ...(process.env.NODE_ENV !== 'production' && { devOtp: otp }),
      });
    }

  } catch (err: any) {
    console.error('Send signup OTP error:', err);
    res.status(500).json({ error: err.message || 'Failed to send OTP' });
  }
});

// Verify signup OTP and create account
router.post('/verify-signup-otp', async (req, res) => {
  try {
    const { phone, otp, email, fullName, role } = req.body;

    if (!phone || !otp || !fullName) {
      return res.status(400).json({ error: 'Phone, OTP, and full name are required' });
    }

    const allowedRoles = ['customer', 'mechanic'];
    if (role && !allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be "customer" or "mechanic"' });
    }

    let formattedPhone = phone;
    if (!phone.startsWith('+')) {
      formattedPhone = `+91${phone}`;
    }

    const storedData = otpStore.get(`signup_${formattedPhone}`);

    if (!storedData) {
      return res.status(400).json({ error: 'OTP expired or not requested' });
    }

    if (Date.now() > storedData.expiresAt) {
      otpStore.delete(`signup_${formattedPhone}`);
      return res.status(400).json({ error: 'OTP has expired' });
    }

    if (storedData.otp !== otp) {
      return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Email is optional, but if given it must not already be in use
    if (email) {
      const { data: existingEmailUser } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('email', email)
        .single();

      if (existingEmailUser) {
        return res.status(400).json({ error: 'Email address already registered' });
      }
    }

    // Prepare user data - email is optional
    const userData: any = {
      full_name: fullName,
      role: role || 'customer',
      phone: formattedPhone
    };

    if (email) {
      userData.email = email;
    }

    // Create user
    const { data: user, error } = await supabaseAdmin
      .from('profiles')
      .insert(userData)
      .select('id, email, full_name, role, phone')
      .single();

    if (error) {
      console.error('Signup DB error:', error);
      return res.status(400).json({ error: error.message });
    }

    otpStore.delete(`signup_${formattedPhone}`);

    const token = signToken({ id: user.id, role: user.role });

    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ 
      success: true,
      token,
      user 
    });

  } catch (err: any) {
    console.error('Verify signup OTP error:', err);
    res.status(500).json({ error: err.message || 'Signup verification failed' });
  }
});

// Logout
router.post('/logout', async (req, res) => {
  res.clearCookie('token');
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
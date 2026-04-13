import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/api/supabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Crown, Mail, Lock, Eye, EyeOff, ArrowRight, Loader2, CheckCircle } from 'lucide-react';

export default function Login() {
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset' | 'reset-sent'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchParams] = useSearchParams();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });

      if (authError) {
        if (authError.message.includes('Invalid login')) {
          setError('אימייל או סיסמה שגויים');
        } else if (authError.message.includes('Email not confirmed')) {
          setError('יש לאשר את כתובת האימייל לפני ההתחברות');
        } else {
          setError(authError.message);
        }
        setLoading(false);
        return;
      }

      window.location.replace('/');
    } catch (err) {
      setError('שגיאה בהתחברות. נסה שוב.');
      setLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (password.length < 6) {
      setError('הסיסמה חייבת להכיל לפחות 6 תווים');
      setLoading(false);
      return;
    }

    try {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
        },
      });

      if (authError) {
        if (authError.message.includes('already registered')) {
          setError('כתובת אימייל זו כבר רשומה במערכת');
        } else {
          setError(authError.message);
        }
        setLoading(false);
        return;
      }

      // Auto-create profile in users table
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('users').insert({
          auth_id: user.id,
          email: email,
          full_name: fullName || email.split('@')[0],
          role: 'user',
          is_active: true,
        }).select().single();
      }

      window.location.replace('/');
    } catch (err) {
      setError('שגיאה בהרשמה. נסה שוב.');
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/login`,
      });

      if (resetError) {
        setError(resetError.message);
        setLoading(false);
        return;
      }

      setMode('reset-sent');
    } catch (err) {
      setError('שגיאה בשליחת הקישור. נסה שוב.');
    }
    setLoading(false);
  };

  const switchMode = (newMode) => {
    setMode(newMode);
    setError('');
    setPassword('');
  };

  return (
    <div className="min-h-screen flex" dir="rtl">
      {/* Right Side - Brand Image */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('https://kingdavid4u.co.il/wp-content/uploads/2024/11/Final1-scaled.jpg')` }}
        />
        <div className="absolute inset-0 bg-gradient-to-l from-black/70 via-black/50 to-black/70" />

        {/* Content Overlay */}
        <div className="relative z-10 flex flex-col justify-center items-center w-full p-16 text-center">
          <div className="mb-8">
            <img
              src="https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png"
              alt="King David"
              className="h-24 mx-auto mb-8 drop-shadow-2xl"
              onError={(e) => { e.target.style.display = 'none'; }}
            />
            <h1 className="text-4xl font-bold text-white tracking-tight mb-3">
              לילות שלווים
            </h1>
            <p className="text-xl text-amber-400 font-medium mb-2">
              מתחילים במזרן הנכון
            </p>
            <div className="h-0.5 w-20 bg-gradient-to-r from-amber-400 to-amber-600 rounded-full mx-auto mt-6" />
          </div>

          <div className="mt-12 grid grid-cols-3 gap-8 text-center">
            <div className="backdrop-blur-sm bg-white/5 rounded-xl p-4">
              <div className="text-2xl font-bold text-white mb-1">CRM</div>
              <div className="text-[10px] text-slate-300 uppercase tracking-widest">ניהול לקוחות</div>
            </div>
            <div className="backdrop-blur-sm bg-white/5 rounded-xl p-4">
              <div className="text-2xl font-bold text-white mb-1">ERP</div>
              <div className="text-[10px] text-slate-300 uppercase tracking-widest">ניהול הזמנות</div>
            </div>
            <div className="backdrop-blur-sm bg-white/5 rounded-xl p-4">
              <div className="text-2xl font-bold text-white mb-1">BI</div>
              <div className="text-[10px] text-slate-300 uppercase tracking-widest">אנליטיקה</div>
            </div>
          </div>
        </div>
      </div>

      {/* Left Side - Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-md">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-8">
            <img
              src="https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png"
              alt="King David"
              className="h-16 mx-auto mb-4"
              onError={(e) => {
                e.target.style.display = 'none';
                e.target.nextSibling.style.display = 'block';
              }}
            />
            <h1 className="text-2xl font-bold text-slate-900" style={{ display: 'none' }}>King David</h1>
          </div>

          {/* Logo on form side */}
          <div className="hidden lg:block mb-8">
            <img
              src="https://kingdavid4u.co.il/wp-content/uploads/2023/09/logo.png"
              alt="King David"
              className="h-12"
            />
          </div>

          {/* Login Form */}
          {mode === 'login' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">ברוכים הבאים</h2>
                <p className="text-slate-500 mt-2">התחבר לחשבון שלך כדי להמשיך</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-sm font-medium text-slate-700">אימייל</Label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      dir="ltr"
                      className="pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="password" className="text-sm font-medium text-slate-700">סיסמה</Label>
                    <button
                      type="button"
                      onClick={() => switchMode('reset')}
                      className="text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                    >
                      שכחת סיסמה?
                    </button>
                  </div>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      dir="ltr"
                      className="pr-10 pl-10 h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 text-white font-medium shadow-lg shadow-slate-900/10 transition-all"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <span className="flex items-center gap-2">
                      התחבר
                      <ArrowRight className="h-4 w-4 rotate-180" />
                    </span>
                  )}
                </Button>
              </form>

              <div className="mt-8 text-center">
                <p className="text-sm text-slate-500">
                  אין לך חשבון?{' '}
                  <button
                    onClick={() => switchMode('signup')}
                    className="text-amber-600 hover:text-amber-700 font-semibold transition-colors"
                  >
                    הירשם עכשיו
                  </button>
                </p>
              </div>
            </>
          )}

          {/* Signup Form */}
          {mode === 'signup' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">יצירת חשבון</h2>
                <p className="text-slate-500 mt-2">הירשם למערכת King David CRM</p>
              </div>

              <form onSubmit={handleSignup} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">שם מלא</Label>
                  <Input
                    type="text"
                    placeholder="ישראל ישראלי"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                    className="h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">אימייל</Label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      dir="ltr"
                      className="pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">סיסמה</Label>
                  <div className="relative">
                    <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="לפחות 6 תווים"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={6}
                      dir="ltr"
                      className="pr-10 pl-10 h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-white font-medium shadow-lg shadow-amber-500/20 transition-all"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    'צור חשבון'
                  )}
                </Button>
              </form>

              <div className="mt-8 text-center">
                <p className="text-sm text-slate-500">
                  כבר יש לך חשבון?{' '}
                  <button
                    onClick={() => switchMode('login')}
                    className="text-amber-600 hover:text-amber-700 font-semibold transition-colors"
                  >
                    התחבר
                  </button>
                </p>
              </div>
            </>
          )}

          {/* Reset Password Form */}
          {mode === 'reset' && (
            <>
              <div className="mb-8">
                <h2 className="text-2xl font-bold text-slate-900">איפוס סיסמה</h2>
                <p className="text-slate-500 mt-2">הזן את כתובת האימייל שלך ונשלח לך קישור לאיפוס</p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-medium text-slate-700">אימייל</Label>
                  <div className="relative">
                    <Mail className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                    <Input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      dir="ltr"
                      className="pr-10 h-12 bg-slate-50 border-slate-200 focus:bg-white transition-colors"
                    />
                  </div>
                </div>

                {error && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full h-12 bg-gradient-to-r from-slate-800 to-slate-900 hover:from-slate-700 hover:to-slate-800 text-white font-medium shadow-lg shadow-slate-900/10 transition-all"
                >
                  {loading ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    'שלח קישור איפוס'
                  )}
                </Button>
              </form>

              <div className="mt-8 text-center">
                <button
                  onClick={() => switchMode('login')}
                  className="text-sm text-slate-500 hover:text-slate-700 transition-colors flex items-center gap-1 mx-auto"
                >
                  <ArrowRight className="h-3 w-3" />
                  חזרה להתחברות
                </button>
              </div>
            </>
          )}

          {/* Reset Sent Confirmation */}
          {mode === 'reset-sent' && (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-50 mb-6">
                <CheckCircle className="h-8 w-8 text-green-500" />
              </div>
              <h2 className="text-2xl font-bold text-slate-900 mb-3">הקישור נשלח!</h2>
              <p className="text-slate-500 mb-8 max-w-xs mx-auto">
                שלחנו קישור לאיפוס סיסמה ל-<br />
                <span className="font-medium text-slate-700" dir="ltr">{email}</span>
              </p>
              <Button
                onClick={() => switchMode('login')}
                variant="outline"
                className="h-12 px-8"
              >
                חזרה להתחברות
              </Button>
            </div>
          )}

          {/* Footer */}
          <div className="mt-12 text-center">
            <p className="text-xs text-slate-400">
              King David CRM &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

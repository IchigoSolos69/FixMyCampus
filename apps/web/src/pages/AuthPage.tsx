import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import type { AuthResponse } from '@fixmycampus/shared';
import { loginSchema, registerSchema, passwordSchema } from '@fixmycampus/shared';
import { useAuth } from '../auth';
import { post } from '../api';
import { Field, FormError, Icon, Loading, Success } from '../components';

export function AuthPage({ mode }: { mode: 'login' | 'register' | 'forgot' | 'reset' | 'verify' }) {
  const { user, loading, accept } = useAuth();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [success, setSuccess] = useState('');
  useEffect(() => {
    setError(null);
    setSuccess('');
  }, [mode]);
  const token = search.get('token') || '';
  const titles = {
    login: 'Welcome back.',
    register: 'Join your campus workspace.',
    forgot: 'Reset your password.',
    reset: 'Choose a new password.',
    verify: 'Verify your email.',
  };
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'login') {
        const data = loginSchema.safeParse(values);
        if (!data.success) throw new Error(data.error.issues[0].message);
        accept(await post<AuthResponse>('/auth/login', data.data));
        const target = (location.state as { from?: string } | null)?.from;
        navigate(target && target.startsWith('/') ? target : '/', { replace: true });
      } else if (mode === 'register') {
        const data = registerSchema.safeParse(values);
        if (!data.success) throw new Error(data.error.issues[0].message);
        await post('/auth/register', data.data);
        setSuccess(
          'Account created. Open the verification email in your campus inbox, then sign in.',
        );
      } else if (mode === 'forgot') {
        await post('/auth/forgot-password', { email: values.email });
        setSuccess('If this email has an account, a password reset link is on its way.');
      } else if (mode === 'reset') {
        const result = passwordSchema.safeParse(values.password);
        if (!result.success) throw new Error(result.error.issues[0].message);
        if (values.password !== values.confirmPassword)
          throw new Error('The passwords do not match.');
        await post('/auth/reset-password', { token, password: values.password });
        setSuccess('Password updated. You can now sign in with your new password.');
      } else {
        await post('/auth/verify-email', { token: token || values.token });
        setSuccess('Your email is verified. You can now sign in.');
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="boot-screen">
        <Loading />
      </div>
    );
  if (user && mode === 'login') return <Navigate to="/" replace />;
  return (
    <div className="auth-layout">
      <aside className="auth-story">
        <Link to="/login" className="brand">
          <span className="brand-mark">
            <Icon name="campus" size={30} />
          </span>
          <span>
            FixMyCampus<small>Campus service desk</small>
          </span>
        </Link>
        <div className="auth-story-body">
          <div className="campus-illustration" aria-hidden="true">
            <svg viewBox="0 0 420 190" fill="none">
              <path d="M28 174h364M58 167V90h304v77M43 89l167-66 167 66H43Z" />
              <path d="M180 160V113h60v47M87 111v46m40-46v46m40-46v46m86-46v46m40-46v46m40-46v46M58 99h304M48 166h324M48 175h324M201 25V8h35v16h-35" />
              <path d="M210 42v25m-14-12h28" />
            </svg>
          </div>
          <h1>
            Small reports.
            <br />A better campus.
          </h1>
          <p>
            One place to raise concerns, track updates, and connect with the people who can help.
          </p>
          <div className="auth-process">
            <span>
              <i>1</i>Report an issue
            </span>
            <span>
              <i>2</i>Track its progress
            </span>
            <span>
              <i>3</i>See it resolved
            </span>
          </div>
        </div>
        <p className="auth-note">
          <Icon name="shield" size={17} /> Your campus account. Your secure workspace.
        </p>
      </aside>
      <main className="auth-main">
        <div className="auth-form-wrap">
          <span className="auth-mobile-brand">FixMyCampus</span>
          <h2>{titles[mode]}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'Sign in with your institutional email to continue.'
              : mode === 'register'
                ? 'Use your institutional email to create an account.'
                : mode === 'forgot'
                  ? 'Enter your campus email and we’ll send you a reset link.'
                  : mode === 'reset'
                    ? 'Use a strong password to keep your account safe.'
                    : 'Confirm your institutional email address to activate your account.'}
          </p>
          <FormError error={error} />
          {success && <Success>{success}</Success>}
          {(!success || mode === 'forgot') && (
            <form onSubmit={submit} className="stack-form">
              {mode === 'register' && (
                <Field label="Full name" required>
                  <input
                    name="name"
                    autoComplete="name"
                    required
                    minLength={2}
                    maxLength={120}
                    placeholder="Your full name"
                  />
                </Field>
              )}
              {['login', 'register', 'forgot'].includes(mode) && (
                <Field label="Institutional email" required>
                  <input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@campus.test"
                  />
                </Field>
              )}
              {['login', 'register', 'reset'].includes(mode) && (
                <Field
                  label={mode === 'reset' ? 'New password' : 'Password'}
                  required
                  hint={
                    mode === 'register' || mode === 'reset'
                      ? 'At least 12 characters, with uppercase, lowercase, a number and a symbol.'
                      : undefined
                  }
                >
                  <input
                    name="password"
                    type="password"
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    required
                    minLength={mode === 'login' ? 1 : 12}
                    maxLength={128}
                  />
                </Field>
              )}
              {mode === 'reset' && (
                <Field label="Confirm new password" required>
                  <input
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                  />
                </Field>
              )}
              {mode === 'verify' && !token && (
                <Field label="Verification token" required>
                  <input name="token" required autoComplete="off" />
                </Field>
              )}
              {mode === 'login' && (
                <Link className="forgot-link" to="/forgot-password">
                  Forgot password?
                </Link>
              )}
              <button className="button primary auth-submit" type="submit" disabled={busy}>
                {busy
                  ? 'Please wait…'
                  : {
                      login: 'Sign in',
                      register: 'Create account',
                      forgot: 'Send reset link',
                      reset: 'Update password',
                      verify: 'Verify email',
                    }[mode]}
                <Icon name="arrow" size={18} />
              </button>
            </form>
          )}
          <p className="auth-switch">
            {mode === 'login' ? (
              <>
                New to FixMyCampus? <Link to="/register">Create an account</Link>
              </>
            ) : (
              <>
                Already have an account? <Link to="/login">Sign in</Link>
              </>
            )}
          </p>
          <div className="auth-support">
            <Icon name="campus" size={18} />
            <span>For account access, contact your campus administrator.</span>
          </div>
        </div>
        <footer>FixMyCampus · Campus services</footer>
      </main>
    </div>
  );
}

import React, { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useWorkspace } from '../context/WorkspaceContext';
import { PrimaryButton, TextInput } from './ui/Controls';
import { ErrorBanner } from './ui/Overlays';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    user,
    authLoading,
    authInitialized,
    registrationOpen,
    authError,
    signInWithPassword,
    setupOwnerAccount,
  } = useWorkspace();

  const [mode, setMode] = useState<'login' | 'setup'>('login');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');

  // Owner / account setup fields
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--canvas)] p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-6 h-6 rounded-full border-2 border-[var(--border)] border-t-[var(--text-primary)] animate-spin" />
          <p className="text-xs text-[var(--text-muted)]">Verifying workspace session...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    const isSetupView = !authInitialized || (registrationOpen && mode === 'setup');
    const visibleError = localError || authError;

    const handleLoginSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);
      if (!identifier.trim() || !password) {
        setLocalError('Please enter your email or username and password.');
        return;
      }
      setSubmitting(true);
      try {
        await signInWithPassword(identifier.trim(), password);
      } catch {
        // authError is populated by WorkspaceContext
      } finally {
        setSubmitting(false);
      }
    };

    const handleSetupSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setLocalError(null);
      if (!username.trim() || !email.trim() || !password) {
        setLocalError('Username, email, and password are required.');
        return;
      }
      if (password.length < 8) {
        setLocalError('Password must be at least 8 characters long.');
        return;
      }
      if (password !== confirmPassword) {
        setLocalError('Passwords do not match.');
        return;
      }
      setSubmitting(true);
      try {
        await setupOwnerAccount({
          username: username.trim(),
          email: email.trim(),
          displayName: displayName.trim() || username.trim(),
          password,
        });
      } catch {
        // authError is populated by WorkspaceContext
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--canvas)] p-6">
        <div className="w-full max-w-md p-6 rounded-lg bg-[var(--surface)] border border-[var(--border)] space-y-5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-[var(--text-primary)]">
              <ShieldCheck className="w-5 h-5" />
              <h1 className="text-xl font-semibold tracking-tight">ATK Deck</h1>
            </div>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">
              {isSetupView
                ? !authInitialized
                  ? 'Set up your private owner account to initialize your self-hosted trading journal.'
                  : 'Create an account to access your isolated personal trading workspace.'
                : 'Private personal trading journal and session workspace. Sign in with your email or username and password.'}
            </p>
          </div>

          {visibleError && <ErrorBanner title="Authentication Notice" message={visibleError} />}

          {isSetupView ? (
            <form onSubmit={handleSetupSubmit} className="space-y-3">
              <TextInput
                label="Display Name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="e.g. Alex Trader"
                autoComplete="name"
              />
              <TextInput
                label="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. atk"
                autoComplete="username"
                required
              />
              <TextInput
                label="Email Address"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
              <TextInput
                label="Password (min 8 characters)"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <TextInput
                label="Confirm Password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <div className="pt-1 flex flex-col gap-2.5">
                <PrimaryButton type="submit" disabled={submitting} className="w-full">
                  {submitting
                    ? 'Creating Workspace...'
                    : !authInitialized
                    ? 'Create Owner Account'
                    : 'Create Account'}
                </PrimaryButton>
                {authInitialized && registrationOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      setMode('login');
                    }}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    Already have an account? Sign in
                  </button>
                )}
              </div>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="space-y-3">
              <TextInput
                label="Email or Username"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                placeholder="Username or email address"
                autoComplete="username"
                required
              />
              <TextInput
                label="Password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
              <div className="pt-1 flex flex-col gap-2.5">
                <PrimaryButton type="submit" disabled={submitting} className="w-full">
                  {submitting ? 'Signing in...' : 'Sign In'}
                </PrimaryButton>
                {registrationOpen && (
                  <button
                    type="button"
                    onClick={() => {
                      setLocalError(null);
                      setMode('setup');
                    }}
                    className="text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)] underline cursor-pointer"
                  >
                    Create a new account
                  </button>
                )}
              </div>
            </form>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

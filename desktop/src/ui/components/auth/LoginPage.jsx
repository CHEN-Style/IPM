import React, { useCallback, useEffect, useRef, useState } from 'react';
import appIconUrl from '../../../../assets/icon.png';

// C3.5 Login / Register screen.
//
// Full-screen, Linear-style dark surface. Two modes: login (email + password)
// and register (invite code + email + password + display name). A discreet
// "offline" escape hatch lets users run without an account (cloud features
// disabled). On success the main process saves the token pair and relaunches
// into the per-user data scope, so this component only needs to surface
// progress + errors.

const FIELD_STYLE = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 8,
  outline: 'none',
  color: '#fff',
  fontSize: 13,
  padding: '10px 12px',
  width: '100%',
  transition: 'border-color 0.2s, background 0.2s',
};

function Field({ label, ...props }) {
  const ref = useRef(null);
  return (
    <label className="block">
      <span className="block text-[11px] mb-1.5 tracking-[0.04em]" style={{ color: 'rgba(255,255,255,0.4)' }}>
        {label}
      </span>
      <input
        ref={ref}
        style={FIELD_STYLE}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.25)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.06)';
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
          e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
        }}
        {...props}
      />
    </label>
  );
}

const LoginPage = ({ onOfflineChosen }) => {
  const [mode, setMode] = useState('login'); // login | register
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const reset = () => {
    setError('');
    setSuccess('');
  };

  const submit = useCallback(async () => {
    reset();
    if (!email.trim() || !password) {
      setError('请输入邮箱和密码。');
      return;
    }
    if (mode === 'register' && (!inviteCode.trim() || !displayName.trim())) {
      setError('请填写邀请码和昵称。');
      return;
    }
    setBusy(true);
    try {
      const api = window.ipm?.auth;
      const res =
        mode === 'login'
          ? await api?.login({ email: email.trim(), password })
          : await api?.register({
              inviteCode: inviteCode.trim(),
              email: email.trim(),
              password,
              displayName: displayName.trim(),
            });
      if (res?.ok) {
        setSuccess(mode === 'login' ? '登录成功，正在进入工作区…' : '注册成功，正在进入工作区…');
        // Main process relaunches shortly; keep the success state visible.
      } else {
        setError(res?.error || '操作失败，请重试。');
        setBusy(false);
      }
    } catch (err) {
      setError(err?.message || String(err));
      setBusy(false);
    }
  }, [mode, email, password, inviteCode, displayName]);

  const chooseOffline = useCallback(async () => {
    reset();
    setBusy(true);
    try {
      const res = await window.ipm?.auth?.useOffline();
      if (res?.ok) {
        if (res.relaunching) {
          setSuccess('正在切换到离线模式…');
        } else {
          onOfflineChosen?.();
        }
      } else {
        setBusy(false);
      }
    } catch {
      setBusy(false);
    }
  }, [onOfflineChosen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Enter' && !busy) submit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [submit, busy]);

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center select-none overflow-hidden" style={{ background: '#060608' }}>
      <style>{`
        @keyframes lp-glow {
          0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 0.10; }
          50% { transform: translate(-46%, -54%) scale(1.12); opacity: 0.16; }
        }
      `}</style>

      {/* Ambient warm glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{
            width: 620, height: 620, left: '52%', top: '46%',
            background: 'radial-gradient(circle, rgba(180,140,100,1) 0%, rgba(120,80,40,0.35) 42%, transparent 70%)',
            filter: 'blur(80px)',
            animation: 'lp-glow 20s ease-in-out infinite',
          }}
        />
      </div>

      {/* Drag strip so the frameless window stays movable */}
      <div className="absolute top-0 left-0 right-0 h-9" style={{ WebkitAppRegion: 'drag' }} />

      <div className="relative z-10 w-full max-w-[360px] px-4">
        {/* Brand */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-xl overflow-hidden mb-4" style={{ border: '1px solid rgba(255,255,255,0.06)' }}>
            <img src={appIconUrl} alt="" className="w-full h-full object-contain" draggable={false} />
          </div>
          <h1 className="text-[22px] font-bold tracking-[-0.02em]" style={{ color: '#fff' }}>
            {mode === 'login' ? '登录 KnowVault' : '加入 KnowVault'}
          </h1>
          <p className="text-[12px] mt-1.5" style={{ color: 'rgba(255,255,255,0.3)' }}>
            {mode === 'login' ? '使用云端账号登录以协作' : '输入邀请码创建你的账号'}
          </p>
        </div>

        {/* Form */}
        <div className="space-y-3.5">
          {mode === 'register' && (
            <Field
              label="邀请码"
              placeholder="IPM-XXXX-XXXX"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              autoCapitalize="characters"
            />
          )}
          <Field
            label="邮箱"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
          />
          <Field
            label="密码"
            type="password"
            placeholder={mode === 'register' ? '至少 6 位' : '••••••••'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
          {mode === 'register' && (
            <Field
              label="昵称"
              placeholder="显示名称"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          )}
        </div>

        {/* Error / success */}
        {error && (
          <div className="mt-3.5 text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(220,80,80,0.10)', border: '1px solid rgba(220,80,80,0.25)', color: 'rgba(240,150,150,0.95)' }}>
            {error}
          </div>
        )}
        {success && (
          <div className="mt-3.5 text-[12px] px-3 py-2 rounded-lg" style={{ background: 'rgba(120,180,120,0.10)', border: '1px solid rgba(120,180,120,0.25)', color: 'rgba(160,220,160,0.95)' }}>
            {success}
          </div>
        )}

        {/* Submit */}
        <button
          type="button"
          disabled={busy}
          onClick={submit}
          className="mt-5 w-full h-10 rounded-lg text-[13px] font-semibold transition-all duration-200"
          style={{
            background: busy ? 'rgba(255,255,255,0.1)' : '#fff',
            color: busy ? 'rgba(255,255,255,0.5)' : '#111',
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? '处理中…' : mode === 'login' ? '登录' : '注册并加入'}
        </button>

        {/* Mode toggle */}
        <div className="mt-4 text-center text-[12px]" style={{ color: 'rgba(255,255,255,0.3)' }}>
          {mode === 'login' ? '还没有账号？' : '已有账号？'}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              reset();
            }}
            className="ml-1.5 font-medium"
            style={{ color: 'rgba(180,150,120,0.9)' }}
          >
            {mode === 'login' ? '使用邀请码注册' : '去登录'}
          </button>
        </div>

        {/* Offline escape hatch */}
        <div className="mt-8 pt-5 flex justify-center" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
          <button
            type="button"
            disabled={busy}
            onClick={chooseOffline}
            className="text-[11px] tracking-[0.04em] transition-colors duration-200"
            style={{ color: 'rgba(255,255,255,0.25)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.5)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'rgba(255,255,255,0.25)')}
          >
            暂不登录，离线使用（云端功能将被禁用）
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;

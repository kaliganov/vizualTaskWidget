import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { errorMessage } from '../api';

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('founder@demo.local');
  const [password, setPassword] = useState('demo123');
  const [error, setError] = useState('');

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      nav('/goals');
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <form className="card login" onSubmit={onSubmit}>
      <div className="brand">Visual Paths</div>
      <p className="muted">Схема путей и канбан. Демо-вход.</p>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Пароль"
      />
      {error && <div className="error">{error}</div>}
      <button className="btn" type="submit">Войти</button>
      <p className="muted">founder@demo.local / demo123</p>
    </form>
  );
}
